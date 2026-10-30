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
