// Google sign-in that lasts: the small server piece for hosts that run code (Cloudflare Pages
// Functions, see functions/api/auth). It does the OAuth code flow with the client secret and keeps
// Google's refresh token in an encrypted, HttpOnly cookie, so the browser can get a fresh Drive
// access token any time without a Google window. The data itself never passes through here: the
// browser still talks to Google Drive directly.
//
//   GET  /api/auth/start     → Google's sign-in page
//   GET  /api/auth/callback  ← Google, with a code: sets the session cookie, back to the app
//   POST /api/auth/token     → { access, expiresIn, account } (needs the X-Yielder header)
//   POST /api/auth/signout   → revokes the refresh token, clears the cookie

export interface AuthEnv {
  VITE_GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

type Http = (input: string, init?: RequestInit) => Promise<Response>;

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';
const SCOPES = 'https://www.googleapis.com/auth/drive.file openid email profile';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SESSION = 'yielder_session';
const FLOW = 'yielder_flow';
const COOKIE_PATH = '/api/auth';
/** Browsers cap cookie lifetimes at 400 days; each token request renews it. */
const SESSION_AGE = 400 * 24 * 3600;
const FLOW_AGE = 10 * 60;

interface Session {
  refresh: string;
  email: string | null;
  name: string;
}

interface Flow {
  state: string;
  verifier: string;
}

// Encoding and encryption (Web Crypto: the same in Cloudflare and Node).

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let s = '';

  bytes.forEach(b => (s += String.fromCharCode(b)));

  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));

  return Uint8Array.from(s, c => c.charCodeAt(0));
}

const randomText = (bytes = 32) => toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));

/** The cookie key comes from the client secret, so there is only one secret to set up. */
async function cookieKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);

  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('yielder'), info: encoder.encode('cookie') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function seal(value: unknown, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value))));
  const out = new Uint8Array(iv.length + data.length);

  out.set(iv);
  out.set(data, iv.length);

  return toBase64Url(out);
}

/** Null for anything that isn't a cookie this server sealed (tampered, old key, garbage). */
async function unseal<T>(text: string | undefined, key: CryptoKey): Promise<T | null> {
  if (!text) {
    return null;
  }

  try {
    const bytes = fromBase64Url(text);
    const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));

    return JSON.parse(new TextDecoder().decode(data)) as T;
  } catch {
    return null;
  }
}

// Requests and responses.

function cookiesOf(req: Request): Record<string, string> {
  return Object.fromEntries(
    (req.headers.get('Cookie') ?? '')
      .split(';')
      .map(part => part.trim().split('='))
      .filter(([name, value]) => name && value !== undefined)
      .map(([name, ...rest]) => [name, rest.join('=')]),
  );
}

const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=${COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

function respond(status: number, body: unknown, cookies: string[] = [], location?: string): Response {
  const headers = new Headers({ 'Cache-Control': 'no-store' });

  cookies.forEach(c => headers.append('Set-Cookie', c));

  if (location) {
    headers.set('Location', location);
  }

  if (body !== null) {
    headers.set('Content-Type', 'application/json');
  }

  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

/** Back to the app; on failure with ?auth_error=<code>, which the sign-in screen explains. */
const backToApp = (url: URL, cookies: string[], error?: string) => respond(302, null, cookies, `${url.origin}/${error ? `?auth_error=${error}` : ''}`);

const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});

/** Name and email from the ID token. It comes straight from Google's token endpoint over TLS, so it isn't re-verified. */
function identityOf(idToken: string | undefined): { email: string | null; name: string } {
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(idToken!.split('.')[1]))) as { email?: string; name?: string };

    return { email: claims.email ?? null, name: claims.name ?? '' };
  } catch {
    return { email: null, name: '' };
  }
}

// Routes.

async function start(url: URL, env: AuthEnv, key: CryptoKey): Promise<Response> {
  const flow: Flow = { state: randomText(), verifier: randomText() };
  const challenge = toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(flow.verifier))));
  const params = new URLSearchParams({
    client_id: env.VITE_GOOGLE_CLIENT_ID,
    redirect_uri: `${url.origin}${COOKIE_PATH}/callback`,
    response_type: 'code',
    scope: SCOPES,
    // A refresh token, and Google sends one only when the consent screen was shown.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: flow.state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  return respond(302, null, [cookie(FLOW, await seal(flow, key), FLOW_AGE)], `${GOOGLE_AUTH}?${params}`);
}

async function callback(url: URL, req: Request, env: AuthEnv, key: CryptoKey, http: Http): Promise<Response> {
  const clearFlow = cookie(FLOW, '', 0);
  const flow = await unseal<Flow>(cookiesOf(req)[FLOW], key);
  const code = url.searchParams.get('code');

  if (url.searchParams.get('error')) {
    return backToApp(url, [clearFlow], 'google_denied');
  }

  if (!flow || !code || url.searchParams.get('state') !== flow.state) {
    return backToApp(url, [clearFlow], 'google_failed');
  }

  const res = await http(
    GOOGLE_TOKEN,
    form({
      code,
      client_id: env.VITE_GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}${COOKIE_PATH}/callback`,
      grant_type: 'authorization_code',
      code_verifier: flow.verifier,
    }),
  ).catch(() => null);
  const body = res?.ok ? ((await res.json()) as { refresh_token?: string; scope?: string; id_token?: string }) : null;

  if (!body?.refresh_token) {
    return backToApp(url, [clearFlow], 'google_failed');
  }

  // The consent screen lets people untick Drive; without it there's nowhere to save.
  if (!(body.scope ?? '').split(' ').includes(DRIVE_SCOPE)) {
    await http(GOOGLE_REVOKE, form({ token: body.refresh_token })).catch(() => null);

    return backToApp(url, [clearFlow], 'drive_scope');
  }

  const session: Session = { refresh: body.refresh_token, ...identityOf(body.id_token) };

  return backToApp(url, [clearFlow, cookie(SESSION, await seal(session, key), SESSION_AGE)]);
}

async function token(req: Request, env: AuthEnv, key: CryptoKey, http: Http): Promise<Response> {
  const sealed = cookiesOf(req)[SESSION];
  const session = await unseal<Session>(sealed, key);

  if (!session) {
    return respond(401, { error: 'signed_out' }, sealed ? [cookie(SESSION, '', 0)] : []);
  }

  const res = await http(
    GOOGLE_TOKEN,
    form({ refresh_token: session.refresh, client_id: env.VITE_GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' }),
  ).catch(() => null);

  if (!res) {
    return respond(502, { error: 'google_failed' });
  }

  if (!res.ok) {
    // invalid_grant: revoked in the Google account, or unused for six months. Sign in again.
    return res.status === 400 || res.status === 401 ? respond(401, { error: 'signed_out' }, [cookie(SESSION, '', 0)]) : respond(502, { error: 'google_failed' });
  }

  const body = (await res.json()) as { access_token: string; expires_in: number };

  // Renewing the cookie keeps an active person signed in indefinitely.
  return respond(200, { access: body.access_token, expiresIn: body.expires_in, account: { email: session.email, name: session.name } }, [
    cookie(SESSION, sealed!, SESSION_AGE),
  ]);
}

async function signOut(req: Request, key: CryptoKey, http: Http): Promise<Response> {
  const session = await unseal<Session>(cookiesOf(req)[SESSION], key);

  if (session) {
    await http(GOOGLE_REVOKE, form({ token: session.refresh })).catch(() => null);
  }

  return respond(204, null, [cookie(SESSION, '', 0)]);
}

export async function handleAuth(req: Request, env: AuthEnv, http: Http = (input, init) => fetch(input, init)): Promise<Response> {
  const url = new URL(req.url);
  const route = url.pathname.slice(COOKIE_PATH.length + 1);

  if (!env.VITE_GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return respond(503, { error: 'google_missing' });
  }

  const key = await cookieKey(env.GOOGLE_CLIENT_SECRET);

  if (req.method === 'GET' && route === 'start') {
    return start(url, env, key);
  }

  if (req.method === 'GET' && route === 'callback') {
    return callback(url, req, env, key, http);
  }

  // Calls from the app carry this header; another site's form or link can't add it.
  if (req.method === 'POST' && req.headers.get('X-Yielder') === '1') {
    if (route === 'token') {
      return token(req, env, key, http);
    }

    if (route === 'signout') {
      return signOut(req, key, http);
    }
  }

  return respond(404, { error: 'not_found' });
}
