// Username/password auth with server-side sessions in an HttpOnly cookie.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import type { Request, RequestHandler, Response } from 'express';

import type { User } from '../shared/types';
import { db } from './db';
import { HttpError } from './http';
import { getUser } from './repo';

const COOKIE = 'yielder_session';
const SESSION_DAYS = 30;
const MAX_FAILURES = 8;
const LOCKOUT_MS = 5 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);

  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');

  if (scheme !== 'scrypt' || !saltHex || !hashHex) {
    return false;
  }

  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);

  return timingSafeEqual(actual, expected);
}

// Compared against when the username doesn't exist, so response time doesn't reveal which usernames exist.
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

export function checkPassword(password: string, stored: string | null): boolean {
  return verifyPassword(password, stored ?? DUMMY_HASH) && stored !== null;
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

function readCookie(req: Request): string | null {
  const header = req.headers.cookie ?? '';

  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');

    if (name === COOKIE) {
      return decodeURIComponent(rest.join('='));
    }
  }

  return null;
}

function setCookie(res: Response, value: string, maxAgeSeconds: number) {
  const secure = process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1' ? '; Secure' : '';

  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`,
  );
}

export function startSession(res: Response, userId: number) {
  const token = randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;

  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), userId, expires);
  setCookie(res, token, SESSION_DAYS * 24 * 60 * 60);
}

export function endSession(req: Request, res: Response) {
  const token = readCookie(req);

  if (token) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  }

  setCookie(res, '', 0);
}

export function endOtherSessions(req: Request, userId: number) {
  const token = readCookie(req);

  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, token ? tokenHash(token) : '');
}

export function sessionUser(req: Request): User | null {
  const token = readCookie(req);

  if (!token) {
    return null;
  }

  const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(tokenHash(token)) as
    | { user_id: number; expires_at: number }
    | undefined;

  if (!row || row.expires_at < Date.now()) {
    return null;
  }

  return getUser(row.user_id);
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const user = sessionUser(req);

  if (!user) {
    res.status(401).json({ error: 'Not signed in', code: 'not_signed_in' });

    return;
  }

  res.locals.user = user;
  next();
};

export function currentUser(res: Response): User {
  return res.locals.user as User;
}

// Simple in-memory brute-force protection per username.
const failures = new Map<string, { count: number; until: number }>();

export function assertNotLocked(username: string) {
  const f = failures.get(username.toLowerCase());

  if (f && f.count >= MAX_FAILURES && f.until > Date.now()) {
    throw new HttpError(429, 'Too many attempts. Try again in a few minutes.', 'too_many_attempts');
  }
}

export function recordLogin(username: string, ok: boolean) {
  const key = username.toLowerCase();

  if (ok) {
    failures.delete(key);

    return;
  }

  const f = failures.get(key);
  const count = f && f.until > Date.now() ? f.count + 1 : 1;

  failures.set(key, { count, until: Date.now() + LOCKOUT_MS });
}
