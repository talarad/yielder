// The open data file: the SQLite database in memory, and where it's saved (Google Drive or this
// browser). Every change runs in a transaction and the whole file is saved shortly after; the
// save status is shown in the app so nothing is lost silently.

import { useSyncExternalStore } from 'react';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';

import { AppError } from '../../shared/errors';
import { browserBackend } from '../storage/browser';
import { resumeGoogle, SERVER_SIGN_IN } from '../storage/drive';
import { ConflictError, ReauthError, type StorageBackend } from '../storage/types';
import { Repo } from './repo';
import { emptyDataFile, openDataFile, type Sqlite } from './sqlite';

const SAVE_DELAY = 800;
const MODE_KEY = 'yielder-storage';

let sqlJs: Promise<SqlJsStatic> | null = null;

const loadSql = () => (sqlJs ??= initSqlJs({ locateFile: () => wasmUrl }));

/** 'offline': opened from this device's copy (Google sign-in expired), with nothing unsaved. */
export type SaveState = 'saved' | 'offline' | 'pending' | 'saving' | 'error' | 'conflict' | 'reauth';

export interface SaveStatus {
  state: SaveState;
  lastSaved: number | null;
  error: unknown;
}

class Workspace {
  repo: Repo;
  status: SaveStatus = { state: 'saved', lastSaved: null, error: null };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<void> | null = null;
  private dirty = false;

  constructor(
    public backend: StorageBackend,
    public db: Sqlite,
  ) {
    this.repo = new Repo(db);
  }

  /** Runs a change in a transaction, then saves the file shortly after. */
  change<T>(fn: (repo: Repo) => T): T {
    const result = this.db.transaction(() => fn(this.repo));

    this.dirty = true;
    this.setStatus({ state: 'pending' });
    clearTimeout(this.timer);
    // A failed save shows in the status (with Retry / Reconnect), so the rejection is handled there.
    this.timer = setTimeout(() => void this.save().catch(() => {}), SAVE_DELAY);

    return result;
  }

  /** Saves now if anything changed. Resolves when everything is saved; rejects if saving failed. */
  async save(options: { force?: boolean } = {}): Promise<void> {
    clearTimeout(this.timer);

    if (this.saving) {
      // Another save is running: wait for it, then save whatever changed meanwhile.
      await this.saving.catch(() => {});

      return this.dirty ? this.save(options) : undefined;
    }

    if (!this.dirty && !options.force) {
      return;
    }

    this.dirty = false;
    this.setStatus({ state: 'saving' });
    this.saving = this.write(options);

    try {
      await this.saving;
      this.setStatus({ state: this.dirty ? 'pending' : 'saved', lastSaved: Date.now(), error: null });
    } catch (err) {
      this.dirty = true;
      this.setStatus({ state: err instanceof ConflictError ? 'conflict' : err instanceof ReauthError ? 'reauth' : 'error', error: err });
      throw err;
    } finally {
      this.saving = null;
    }

    if (this.dirty) {
      await this.save();
    }
  }

  private async write(options: { force?: boolean }) {
    // An expired sign-in renews by itself: through the sign-in server, or shortly after a click,
    // when the browser allows Google's window (it closes on its own). Otherwise the save stops at
    // "Reconnect".
    if (this.backend.isConnected?.() === false && (this.backend.renewsSilently || navigator.userActivation?.isActive)) {
      try {
        await this.backend.reconnect?.();
      } catch {
        throw new ReauthError();
      }
    }

    await this.backend.save(this.db.export(), options);
  }

  /** Swaps in other data (a file the person opened, or the latest version from Drive). */
  replace(db: Sqlite) {
    clearTimeout(this.timer);
    this.db.close();
    this.db = db;
    this.repo = new Repo(db);
  }

  get unsaved() {
    return this.status.state !== 'saved' && this.status.state !== 'offline';
  }

  setStatus(patch: Partial<SaveStatus>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach(l => l());
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  };
}

let current: Workspace | null = null;

/** The open data file; throws when signed out. */
export function workspace(): Workspace {
  if (!current) {
    throw new AppError('Not signed in.', 'signed_out');
  }

  return current;
}

export function currentWorkspace(): Workspace | null {
  return current;
}

/** Opens the data file from a backend (an empty one when there's no file yet). */
export async function openWorkspace(backend: StorageBackend): Promise<Workspace> {
  const [SQL, bytes] = await Promise.all([loadSql(), backend.load()]);
  const opened = bytes ? openDataFile(SQL, bytes) : null;

  current = new Workspace(backend, opened?.db ?? emptyDataFile(SQL));

  try {
    localStorage.setItem(MODE_KEY, backend.kind);
  } catch {
    // storage unavailable
  }

  if (opened?.converted) {
    // An old-format file was converted: keep the converted version.
    current.change(() => {});
  } else if (backend.offlineCopy) {
    current.setStatus({ state: 'offline' });
  }

  return current;
}

/** After a reload: the same storage as last time, if that needs no click (no Google window). */
export async function resumeWorkspace(): Promise<Workspace | null> {
  let mode: string | null = null;

  try {
    mode = localStorage.getItem(MODE_KEY);
  } catch {
    // storage unavailable
  }

  if (mode === 'browser') {
    return openWorkspace(browserBackend());
  }

  // With the sign-in server, coming back from Google's sign-in page is also a resume.
  if (mode === 'drive' || (mode === null && SERVER_SIGN_IN)) {
    const backend = await resumeGoogle();

    return backend ? openWorkspace(backend) : null;
  }

  return null;
}

/** The storage used last time, to offer it first on the sign-in screen. */
export function lastStorage(): 'drive' | 'browser' | null {
  try {
    const mode = localStorage.getItem(MODE_KEY);

    return mode === 'drive' || mode === 'browser' ? mode : null;
  } catch {
    return null;
  }
}

/** Replaces all data with a file's bytes (this format or the old server database), and saves. */
export async function replaceData(bytes: Uint8Array) {
  const ws = workspace();
  const { db } = openDataFile(await loadSql(), bytes);

  ws.replace(db);
  ws.change(() => {});
  await ws.save({ force: true });
}

/** Drops unsaved changes and loads the file as it is in storage now (after a conflict). */
export async function reloadFromStorage() {
  const ws = workspace();
  const [SQL, bytes] = await Promise.all([loadSql(), ws.backend.load()]);

  ws.replace(bytes ? openDataFile(SQL, bytes).db : emptyDataFile(SQL));
  ws.setStatus({ state: 'saved', error: null });
}

/**
 * Signs in to Google again (from a click). When the copy on this device was open with nothing
 * unsaved, loads the latest file from Drive; otherwise saves what's pending.
 */
export async function reconnect() {
  const ws = workspace();

  await ws.backend.reconnect?.();

  if (ws.status.state === 'offline') {
    await reloadFromStorage();
  } else {
    await ws.save();
  }
}

/** Saves anything pending, then closes. Throws (and stays open) if the last changes can't be saved. */
export async function closeWorkspace() {
  if (!current) {
    return;
  }

  await current.save();
  current.backend.signOut();
  current.db.close();
  current = null;

  try {
    localStorage.removeItem(MODE_KEY);
  } catch {
    // storage unavailable
  }
}

const SIGNED_OUT: SaveStatus = { state: 'saved', lastSaved: null, error: null };

/** Live save status of the open file, for the UI. */
export function useSaveStatus(): SaveStatus {
  return useSyncExternalStore(
    listener => current?.subscribe(listener) ?? (() => {}),
    () => current?.status ?? SIGNED_OUT,
  );
}

// Leaving the page with unsaved changes asks first.
window.addEventListener('beforeunload', e => {
  if (current?.unsaved) {
    e.preventDefault();
  }
});
