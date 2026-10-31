// Google Drive: the data file lives in the person's own Drive. Sign-in uses Google Identity
// Services in the browser, with the drive.file scope: Yielder can see and change only the file it
// created, never the rest of the Drive. There is no server: the browser talks to Google directly.
//
// Access tokens last an hour and can't be refreshed in the background without a server. So:
// - the token is kept for its hour across tabs and restarts (localStorage);
// - every file loaded or saved is also copied to this device, and after the token expired the app
//   opens that copy, without the sign-in screen;
// - saving then renews the token first (a Google window that closes by itself, allowed because
//   it follows a click), and checks the file's version, so a newer change from another device is
//   never overwritten silently.
// Signing out forgets the token, the account and the copy.

import { AppError } from '../../shared/errors';
import { deviceCopies, type CopyStore } from './browser';
import { ConflictError, ReauthError, type StorageBackend } from './types';

export const GOOGLE_CLIENT_ID = (import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined) || null;

const SCOPES = 'https://www.googleapis.com/auth/drive.file openid email profile';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILE_NAME = 'Yielder data.db';
const MIME = 'application/x-sqlite3';
const TOKEN_KEY = 'yielder-google-token';
const ACCOUNT_KEY = 'yielder-google-account';
/** Files Yielder made carry this, so it finds its file wherever the person moves it. */
const MARK = { key: 'yielder', value: 'data' };

export interface GoogleToken {
  access: string;
  expiresAt: number;
}

type Account = { name: string; email: string | null };

type Http = (input: string, init?: RequestInit) => Promise<Response>;

// Google Identity Services, loaded on demand.

interface TokenResponse {
  access_token: string;
  expires_in: number | string;
  error?: string;
  error_description?: string;
}

interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type: string; message?: string }) => void;
      }): { requestAccessToken(options?: { prompt?: string; login_hint?: string }): void };
      hasGrantedAllScopes(r: TokenResponse, ...scopes: string[]): boolean;
    };
  };
}

declare global {
  interface Window {
    google?: Gis;
  }
}

let gisLoading: Promise<Gis> | null = null;

function loadGis(): Promise<Gis> {
  gisLoading ??= new Promise<Gis>((resolve, reject) => {
    const script = document.createElement('script');

    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => (window.google ? resolve(window.google) : reject(new AppError('Google sign-in failed to load.', 'google_failed')));
    script.onerror = () => {
      gisLoading = null;
      reject(new AppError("Couldn't reach Google. Check your connection.", 'google_failed'));
    };
    document.head.appendChild(script);
  });

  return gisLoading;
}

/** Asks Google for an access token. Must run from a click: it may open a Google window. */
async function requestToken(hint?: string): Promise<GoogleToken> {
  if (!GOOGLE_CLIENT_ID) {
    throw new AppError('Google sign-in is not set up for this site.', 'google_missing');
  }

  const gis = await loadGis();
  const token = await new Promise<GoogleToken>((resolve, reject) => {
    gis.accounts.oauth2
      .initTokenClient({
        client_id: GOOGLE_CLIENT_ID!,
        scope: SCOPES,
        callback: r => {
          if (r.error) {
            reject(new AppError(r.error_description || r.error, 'google_denied'));
          } else if (!gis.accounts.oauth2.hasGrantedAllScopes(r, DRIVE_SCOPE)) {
            // The consent screen lets people untick Drive; without it there's nowhere to save.
            reject(new AppError('Yielder needs permission to save its file in your Drive.', 'drive_scope'));
          } else {
            resolve({ access: r.access_token, expiresAt: Date.now() + Number(r.expires_in) * 1000 });
          }
        },
        error_callback: e => reject(new AppError(e.message || e.type, e.type === 'popup_closed' ? 'google_cancelled' : 'google_failed')),
      })
      .requestAccessToken({ prompt: '', login_hint: hint });
  });

  store(TOKEN_KEY, token);

  return token;
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: the next visit asks again
  }
}

function stored<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

function forget(...keys: string[]) {
  try {
    keys.forEach(k => localStorage.removeItem(k));
  } catch {
    // storage unavailable
  }
}

/** Keeps a minute of margin, so a save doesn't start with a token about to expire. */
const isFresh = (token: GoogleToken | null): token is GoogleToken => !!token && token.expiresAt - Date.now() > 60_000;

export class DriveBackend implements StorageBackend {
  readonly kind = 'drive';
  readonly fileName = FILE_NAME;
  offlineCopy = false;
  private fileId: string | null = null;
  private version: string | null = null;
  private link: string | null = null;

  constructor(
    /** null when opened from this device's copy after the sign-in expired. */
    private token: GoogleToken | null,
    public account: Account,
    private http: Http = (input, init) => fetch(input, init),
    private renew: (hint?: string) => Promise<GoogleToken> = requestToken,
    private copies: CopyStore = deviceCopies,
  ) {}

  private get copyKey() {
    return this.account.email ?? 'google';
  }

  isConnected() {
    return isFresh(this.token);
  }

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    if (!isFresh(this.token)) {
      throw new ReauthError();
    }

    let res: Response;

    try {
      res = await this.http(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${this.token.access}` } });
    } catch {
      throw new AppError("Couldn't reach Google Drive. Check your connection.", 'drive_failed');
    }

    if (res.status === 401) {
      throw new ReauthError();
    }

    if (!res.ok) {
      throw new AppError(`Google Drive answered ${res.status}.`, 'drive_failed');
    }

    return res;
  }

  async reconnect() {
    this.token = await this.renew(this.account.email ?? undefined);
  }

  /** Keeps this device's copy in step with the file in Drive (best effort: it's only a copy). */
  private remember(bytes: Uint8Array) {
    void this.copies.put(this.copyKey, { bytes, fileId: this.fileId, version: this.version, link: this.link, savedAt: Date.now() }).catch(() => {});
  }

  async load(): Promise<Uint8Array | null> {
    if (!this.isConnected()) {
      const copy = await this.copies.get(this.copyKey).catch(() => null);

      if (!copy) {
        throw new ReauthError();
      }

      // Saving later checks this version, so changes made elsewhere meanwhile aren't overwritten.
      this.fileId = copy.fileId;
      this.version = copy.version;
      this.link = copy.link;
      this.offlineCopy = true;

      return copy.bytes;
    }

    const q = encodeURIComponent(`appProperties has { key='${MARK.key}' and value='${MARK.value}' } and trashed = false`);
    const { files } = (await (await this.call(`${API}/files?q=${q}&spaces=drive&orderBy=modifiedTime desc&fields=files(id,version,webViewLink)`)).json()) as {
      files: Array<{ id: string; version: string; webViewLink?: string }>;
    };
    const file = files[0];

    if (!file) {
      return null;
    }

    const res = await this.call(`${API}/files/${file.id}?alt=media`);
    const bytes = new Uint8Array(await res.arrayBuffer());

    this.fileId = file.id;
    this.version = file.version;
    this.link = file.webViewLink ?? null;
    this.offlineCopy = false;
    this.remember(bytes);

    return bytes;
  }

  async save(bytes: Uint8Array, { force = false } = {}) {
    if (!this.fileId) {
      await this.create(bytes);
      this.offlineCopy = false;
      this.remember(bytes);

      return;
    }

    if (!force) {
      const { version } = (await (await this.call(`${API}/files/${this.fileId}?fields=version`)).json()) as { version: string };

      if (version !== this.version) {
        throw new ConflictError();
      }
    }

    const res = await this.call(`${UPLOAD}/files/${this.fileId}?uploadType=media&fields=version`, {
      method: 'PATCH',
      headers: { 'Content-Type': MIME },
      body: bytes as BodyInit,
    });

    this.version = ((await res.json()) as { version: string }).version;
    this.offlineCopy = false;
    this.remember(bytes);
  }

  private async create(bytes: Uint8Array) {
    const boundary = `yielder-${Math.random().toString(36).slice(2)}`;
    const metadata = {
      name: FILE_NAME,
      mimeType: MIME,
      appProperties: { [MARK.key]: MARK.value },
      description: 'Yielder: your funds and monthly balances. Open it with the Yielder app.',
    };
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: ${MIME}\r\n\r\n`,
      bytes as BlobPart,
      `\r\n--${boundary}--`,
    ]);
    const res = await this.call(`${UPLOAD}/files?uploadType=multipart&fields=id,version,webViewLink`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    const file = (await res.json()) as { id: string; version: string; webViewLink?: string };

    this.fileId = file.id;
    this.version = file.version;
    this.link = file.webViewLink ?? null;
  }

  fileUrl() {
    return this.link;
  }

  signOut() {
    forget(TOKEN_KEY, ACCOUNT_KEY);
    void this.copies.remove(this.copyKey).catch(() => {});
  }
}

async function accountOf(token: GoogleToken, http: Http = (input, init) => fetch(input, init)): Promise<Account> {
  try {
    const res = await http('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token.access}` } });
    const info = (await res.json()) as { name?: string; email?: string };

    return { name: info.name ?? '', email: info.email ?? null };
  } catch {
    return { name: '', email: null };
  }
}

/** Opens Google's sign-in (from a click). */
export async function signInWithGoogle(): Promise<DriveBackend> {
  const token = await requestToken();
  const account = await accountOf(token);

  store(ACCOUNT_KEY, account);

  return new DriveBackend(token, account);
}

/**
 * The earlier sign-in on this device, without a Google window: with Drive while its token is valid,
 * otherwise this device's copy of the file. Null when there's neither.
 */
export async function resumeGoogle(copies: CopyStore = deviceCopies): Promise<DriveBackend | null> {
  const token = stored<GoogleToken>(TOKEN_KEY);
  const account = stored<Account>(ACCOUNT_KEY);

  if (isFresh(token)) {
    const who = account ?? (await accountOf(token));

    store(ACCOUNT_KEY, who);

    return new DriveBackend(token, who, undefined, undefined, copies);
  }

  if (account?.email && (await copies.get(account.email).catch(() => null))) {
    return new DriveBackend(null, account, undefined, undefined, copies);
  }

  return null;
}
