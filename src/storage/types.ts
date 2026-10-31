import { AppError } from '../../shared/errors';

/** Where the data file lives: the person's Google Drive, or this browser only. */
export interface StorageBackend {
  kind: 'drive' | 'browser';
  /** Who is signed in (Google), for display. */
  account: { name: string; email: string | null };
  /** The data file's bytes, or null when there is no file yet. */
  load(): Promise<Uint8Array | null>;
  /** Writes the file. Throws ConflictError if it changed elsewhere since it was loaded, unless forced. */
  save(bytes: Uint8Array, options?: { force?: boolean }): Promise<void>;
  /** Gets a fresh sign-in after it expired (must run from a click: it may open a Google window). */
  reconnect?(): Promise<void>;
  /** False while the sign-in has expired: saving first needs reconnect(). */
  isConnected?(): boolean;
  /** True when load() returned the copy kept on this device, not yet checked against storage. */
  offlineCopy?: boolean;
  /** A link to open the file where it lives, if it has one. */
  fileUrl(): string | null;
  fileName: string;
  signOut(): void;
}

/** The file was changed on another device or tab since this one loaded it. */
export class ConflictError extends AppError {
  constructor() {
    super('The data was changed on another device.', 'conflict');
  }
}

/** The sign-in expired; a click on "Reconnect" fixes it. */
export class ReauthError extends AppError {
  constructor() {
    super('Google sign-in expired.', 'reauth');
  }
}
