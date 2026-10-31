// "This browser only": the data file in IndexedDB, on this device. No account, nothing leaves
// the browser.

import { AppError } from '../../shared/errors';
import type { StorageBackend } from './types';

const DB_NAME = 'yielder';
const STORE = 'files';
const KEY = 'data';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);

    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new AppError("This browser doesn't allow saving data here.", 'browser_storage'));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const idb = await openIdb();

  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(idb.transaction(STORE, mode).objectStore(STORE));

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new AppError("This browser couldn't save the data.", 'browser_storage'));
    });
  } finally {
    idb.close();
  }
}

export function browserBackend(): StorageBackend {
  return {
    kind: 'browser',
    account: { name: '', email: null },
    fileName: 'yielder.db',
    load: async () => {
      const value = await run<unknown>('readonly', s => s.get(KEY));

      return value instanceof Uint8Array ? value : null;
    },
    save: async bytes => {
      await run('readwrite', s => s.put(bytes, KEY));
    },
    fileUrl: () => null,
    signOut: () => {},
  };
}

/** Deletes the data kept in this browser. */
export async function clearBrowserData() {
  await run('readwrite', s => s.delete(KEY));
}

/**
 * The last copy of a Google Drive file seen on this device, so the app opens straight into the data
 * after the Google sign-in expired. Removed on sign-out.
 */
export interface DeviceCopy {
  bytes: Uint8Array;
  fileId: string | null;
  version: string | null;
  link: string | null;
  savedAt: number;
}

export interface CopyStore {
  get(key: string): Promise<DeviceCopy | null>;
  put(key: string, copy: DeviceCopy): Promise<void>;
  remove(key: string): Promise<void>;
}

export const deviceCopies: CopyStore = {
  get: async key => {
    const value = await run<unknown>('readonly', s => s.get(`copy:${key}`));

    return value && (value as DeviceCopy).bytes instanceof Uint8Array ? (value as DeviceCopy) : null;
  },
  put: async (key, copy) => {
    await run('readwrite', s => s.put(copy, `copy:${key}`));
  },
  remove: async key => {
    await run('readwrite', s => s.delete(`copy:${key}`));
  },
};
