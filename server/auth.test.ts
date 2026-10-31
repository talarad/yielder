import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { handleAuth, type AuthEnv } from './auth';

const env: AuthEnv = { VITE_GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'client-secret' };
const SITE = 'https://yielder.example';
const DRIVE = 'https://www.googleapis.com/auth/drive.file';

/** An ID token as Google sends it; only the claims part is read. */
const idToken = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;

/** A stand-in for Google's token and revoke endpoints. */
function fakeGoogle(scope = `${DRIVE} openid`) {
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const revoked = new Set<string>();

  const http = async (url: string, init: RequestInit = {}) => {
    const body = new URLSearchParams(String(init.body));

    calls.push({ url, body });

    if (url.endsWith('/revoke')) {
      revoked.add(body.get('token')!);

      return new Response('');
    }

    if (body.get('grant_type') === 'authorization_code') {
      return Response.json({ access_token: 'a1', expires_in: 3599, refresh_token: 'r1', scope, id_token: idToken({ email: 'tal@example.com', name: 'Tal' }) });
    }

    if (body.get('grant_type') === 'refresh_token') {
      return revoked.has(body.get('refresh_token')!) ? Response.json({ error: 'invalid_grant' }, { status: 400 }) : Response.json({ access_token: 'a2', expires_in: 3599 });
    }

    return new Response('', { status: 404 });
  };

  return { calls, revoked, http };
}

/** A browser's cookie jar for this site, enough for these tests. */
function browser(google: ReturnType<typeof fakeGoogle>) {
  const jar = new Map<string, string>();

  const send = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);

    if (jar.size) {
      headers.set('Cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    }

    const res = await handleAuth(new Request(`${SITE}${path}`, { ...init, headers }), env, google.http);

    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split('; ');
      const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];

      assert.ok(attrs.includes('HttpOnly') && attrs.includes('Secure') && attrs.includes('SameSite=Lax'));

      if (attrs.includes('Max-Age=0')) {
        jar.delete(name);
      } else {
        jar.set(name, value);
      }
    }

    return res;
  };

  /** Sign-in: the app's start link, then Google sending the browser back with a code. */
  const signIn = async () => {
    const toGoogle = new URL((await send('/api/auth/start')).headers.get('Location')!);

    return send(`/api/auth/callback?code=c1&state=${toGoogle.searchParams.get('state')}`);
  };

  const token = () => send('/api/auth/token', { method: 'POST', headers: { 'X-Yielder': '1' } });

  return { jar, send, signIn, token };
}

describe('lasting Google sign-in (server)', () => {
  it('sends the browser to Google asking for a refresh token, with PKCE', async () => {
    const res = await browser(fakeGoogle()).send('/api/auth/start');
    const to = new URL(res.headers.get('Location')!);

    assert.equal(res.status, 302);
    assert.equal(to.origin + to.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(to.searchParams.get('access_type'), 'offline');
    assert.equal(to.searchParams.get('redirect_uri'), `${SITE}/api/auth/callback`);
    assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
    assert.match(to.searchParams.get('scope')!, /drive\.file/);
  });

  it('signs in, then hands out fresh access tokens without Google windows', async () => {
    const google = fakeGoogle();
    const b = browser(google);
    const back = await b.signIn();

    assert.equal(back.headers.get('Location'), `${SITE}/`);
    assert.ok(b.jar.has('yielder_session'));
    assert.ok(!b.jar.has('yielder_flow'));
    // The code exchange used the secret and the PKCE verifier.
    const exchange = google.calls.find(c => c.body.get('grant_type') === 'authorization_code')!;

    assert.equal(exchange.body.get('client_secret'), 'client-secret');
    assert.ok(exchange.body.get('code_verifier'));
    // The refresh token stays inside the encrypted cookie.
    assert.ok(!b.jar.get('yielder_session')!.includes('r1'));

    const res = await b.token();

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { access: 'a2', expiresIn: 3599, account: { email: 'tal@example.com', name: 'Tal' } });
  });

  it('refuses token requests without the app header, and without a session', async () => {
    const b = browser(fakeGoogle());

    await b.signIn();
    assert.equal((await b.send('/api/auth/token', { method: 'POST' })).status, 404);
    assert.equal((await b.send('/api/auth/token', { method: 'GET' })).status, 404);

    const stranger = browser(fakeGoogle());

    assert.equal((await stranger.token()).status, 401);
  });

  it('rejects a callback whose state does not match (a forged sign-in)', async () => {
    const b = browser(fakeGoogle());

    await b.send('/api/auth/start');
    const res = await b.send('/api/auth/callback?code=c1&state=forged');

    assert.equal(res.headers.get('Location'), `${SITE}/?auth_error=google_failed`);
    assert.ok(!b.jar.has('yielder_session'));
  });

  it('turns away a sign-in without the Drive permission, and drops that grant', async () => {
    const google = fakeGoogle('openid email');
    const b = browser(google);
    const res = await b.signIn();

    assert.equal(res.headers.get('Location'), `${SITE}/?auth_error=drive_scope`);
    assert.ok(!b.jar.has('yielder_session'));
    assert.ok(google.revoked.has('r1'));
  });

  it('ignores a tampered cookie', async () => {
    const b = browser(fakeGoogle());

    await b.signIn();
    const sealed = b.jar.get('yielder_session')!;

    b.jar.set('yielder_session', sealed.slice(0, -4) + (sealed.endsWith('AAAA') ? 'BBBB' : 'AAAA'));
    assert.equal((await b.token()).status, 401);
    assert.ok(!b.jar.has('yielder_session'));
  });

  it('signs out: revokes the refresh token and clears the cookie', async () => {
    const google = fakeGoogle();
    const b = browser(google);

    await b.signIn();
    const res = await b.send('/api/auth/signout', { method: 'POST', headers: { 'X-Yielder': '1' } });

    assert.equal(res.status, 204);
    assert.ok(google.revoked.has('r1'));
    assert.ok(!b.jar.has('yielder_session'));
  });

  it('asks to sign in again when Google no longer accepts the refresh token', async () => {
    const google = fakeGoogle();
    const b = browser(google);

    await b.signIn();
    google.revoked.add('r1'); // e.g. removed in the Google account's third-party connections
    assert.equal((await b.token()).status, 401);
    assert.ok(!b.jar.has('yielder_session'));
  });
});
