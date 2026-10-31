import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CopyStore, DeviceCopy } from './browser';
import { DriveBackend, type GoogleToken } from './drive';
import { ConflictError, ReauthError } from './types';

/** A tiny stand-in for the Drive API endpoints the app uses. */
function fakeDrive() {
  const files = new Map<string, { bytes: Uint8Array; version: number; props: Record<string, string> }>();
  let next = 1;
  let expired = false;

  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

  const http = async (url: string, init: RequestInit = {}): Promise<Response> => {
    if (expired) {
      return new Response('', { status: 401 });
    }

    const u = new URL(url);
    const method = init.method ?? 'GET';
    const id = /\/files\/([^/?]+)/.exec(u.pathname)?.[1];

    if (method === 'GET' && u.pathname.endsWith('/drive/v3/files')) {
      assert.match(u.searchParams.get('q')!, /appProperties has \{ key='yielder' and value='data' \} and trashed = false/);

      return json({ files: [...files].filter(([, f]) => f.props.yielder === 'data').map(([fid, f]) => ({ id: fid, version: String(f.version) })) });
    }

    if (method === 'GET' && id && u.searchParams.get('alt') === 'media') {
      return new Response(files.get(id)!.bytes as BodyInit);
    }

    if (method === 'GET' && id) {
      return json({ version: String(files.get(id)!.version) });
    }

    if (method === 'POST' && u.pathname.startsWith('/upload/drive/v3/files')) {
      const boundary = /boundary=(.+)$/.exec(String((init.headers as Record<string, string>)['Content-Type']))![1];
      const text = new TextDecoder().decode(await new Response(init.body as BodyInit).arrayBuffer());
      const [, metaPart, filePart] = text.split(`--${boundary}`);
      const meta = JSON.parse(metaPart.split('\r\n\r\n')[1]) as { appProperties: Record<string, string> };
      const fid = `f${next++}`;

      files.set(fid, { bytes: new TextEncoder().encode(filePart.split('\r\n\r\n')[1].replace(/\r\n$/, '')), version: 1, props: meta.appProperties });

      return json({ id: fid, version: '1' });
    }

    if (method === 'PATCH' && id) {
      const f = files.get(id)!;

      f.bytes = new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
      f.version++;

      return json({ version: String(f.version) });
    }

    return new Response('', { status: 404 });
  };

  return { files, http, expire: () => (expired = true) };
}

/** This device's copies, in memory instead of IndexedDB. */
function memoryCopies(): CopyStore & { map: Map<string, DeviceCopy> } {
  const map = new Map<string, DeviceCopy>();

  return {
    map,
    get: async key => map.get(key) ?? null,
    put: async (key, copy) => void map.set(key, copy),
    remove: async key => void map.delete(key),
  };
}

const token = (): GoogleToken => ({ access: 'test-token', expiresAt: Date.now() + 3600_000 });
const text = (s: string) => new TextEncoder().encode(s);
const read = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);
const account = { name: 'Tal', email: 'tal@example.com' };
const flush = () => new Promise(r => setTimeout(r, 0));

describe('Google Drive storage', () => {
  it('has no file at first, creates one on the first save, and finds it next time', async () => {
    const drive = fakeDrive();
    const first = new DriveBackend(token(), account, drive.http, undefined, memoryCopies());

    assert.equal(await first.load(), null);
    await first.save(text('v1'));
    assert.equal(drive.files.size, 1);

    const later = new DriveBackend(token(), account, drive.http, undefined, memoryCopies());

    assert.equal(read(await later.load()), 'v1');
  });

  it('updates the same file on later saves', async () => {
    const drive = fakeDrive();
    const backend = new DriveBackend(token(), account, drive.http, undefined, memoryCopies());

    await backend.load();
    await backend.save(text('v1'));
    await backend.save(text('v2'));
    await backend.save(text('v3'));

    assert.equal(drive.files.size, 1);
    assert.equal(read([...drive.files.values()][0].bytes), 'v3');
  });

  it('refuses to overwrite a change made on another device, unless forced', async () => {
    const drive = fakeDrive();
    const phone = new DriveBackend(token(), account, drive.http, undefined, memoryCopies());
    const laptop = new DriveBackend(token(), account, drive.http, undefined, memoryCopies());

    await phone.load();
    await phone.save(text('start'));
    await laptop.load();
    await phone.load();

    await laptop.save(text('from laptop'));
    await assert.rejects(phone.save(text('from phone')), ConflictError);
    assert.equal(read([...drive.files.values()][0].bytes), 'from laptop');

    await phone.save(text('from phone'), { force: true });
    assert.equal(read([...drive.files.values()][0].bytes), 'from phone');
  });

  it('asks to reconnect when the sign-in expired, and saves after reconnecting', async () => {
    const drive = fakeDrive();
    let renewed = 0;
    const backend = new DriveBackend(
      { access: 'old', expiresAt: Date.now() - 1 },
      account,
      drive.http,
      async () => {
        renewed++;

        return token();
      },
      memoryCopies(),
    );

    // No copy on this device yet: nothing to show without signing in.
    await assert.rejects(backend.load(), ReauthError);
    await backend.reconnect();
    assert.equal(renewed, 1);
    assert.equal(await backend.load(), null);

    drive.expire();
    await assert.rejects(backend.save(text('x')), ReauthError);
  });

  it('opens the copy on this device after the sign-in expired, and saves to Drive after reconnecting', async () => {
    const drive = fakeDrive();
    const copies = memoryCopies();
    const earlier = new DriveBackend(token(), account, drive.http, undefined, copies);

    await earlier.load();
    await earlier.save(text('v1'));
    await flush();

    const later = new DriveBackend(null, account, drive.http, async () => token(), copies);

    assert.equal(read(await later.load()), 'v1');
    assert.equal(later.offlineCopy, true);
    assert.equal(later.isConnected(), false);
    await assert.rejects(later.save(text('v2')), ReauthError);

    await later.reconnect();
    await later.save(text('v2'));
    await flush();

    assert.equal(later.offlineCopy, false);
    assert.equal(read([...drive.files.values()][0].bytes), 'v2');
    assert.equal(read(copies.map.get(account.email)!.bytes), 'v2');
  });

  it("never lets an old copy overwrite a newer change from another device", async () => {
    const drive = fakeDrive();
    const laptopCopies = memoryCopies();
    const laptop = new DriveBackend(token(), account, drive.http, undefined, laptopCopies);

    await laptop.load();
    await laptop.save(text('start'));
    await flush();

    const phone = new DriveBackend(token(), account, drive.http, undefined, memoryCopies());

    await phone.load();
    await phone.save(text('from phone'));

    // Next day on the laptop: the copy is from before the phone's change.
    const nextDay = new DriveBackend(null, account, drive.http, async () => token(), laptopCopies);

    assert.equal(read(await nextDay.load()), 'start');
    await nextDay.reconnect();
    await assert.rejects(nextDay.save(text('from laptop')), ConflictError);
    assert.equal(read([...drive.files.values()][0].bytes), 'from phone');
  });

  it('removes the copy on this device when signing out', async () => {
    const drive = fakeDrive();
    const copies = memoryCopies();
    const backend = new DriveBackend(token(), account, drive.http, undefined, copies);

    await backend.load();
    await backend.save(text('v1'));
    await flush();
    assert.equal(copies.map.size, 1);

    backend.signOut();
    await flush();
    assert.equal(copies.map.size, 0);
  });
});
