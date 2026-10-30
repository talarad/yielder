import { Router } from 'express';
import { z } from 'zod';

import {
  assertNotLocked,
  checkPassword,
  currentUser,
  endOtherSessions,
  endSession,
  hashPassword,
  recordLogin,
  requireAuth,
  startSession,
} from '../auth';
import { HttpError, parse } from '../http';
import { createUser, deleteUser, findUserByUsername, getPasswordHash, setPasswordHash, updateUser } from '../repo';
import { passwordSchema, usernameSchema } from '../schemas';

export const authRouter = Router();

authRouter.post('/register', (req, res) => {
  const body = parse(
    z.object({
      username: usernameSchema,
      password: passwordSchema,
      displayName: z.string().trim().max(60).optional(),
      shareAnonymously: z.boolean().optional(),
    }),
    req.body,
  );

  if (findUserByUsername(body.username)) {
    throw new HttpError(409, 'That username is taken', 'username_taken');
  }

  const user = createUser(body.username, body.displayName || body.username, hashPassword(body.password), body.shareAnonymously ?? true);

  startSession(res, user.id);
  res.status(201).json(user);
});

authRouter.post('/login', (req, res) => {
  const { username, password } = parse(z.object({ username: z.string().trim().min(1), password: z.string().min(1) }), req.body);

  assertNotLocked(username);

  const found = findUserByUsername(username);
  const ok = checkPassword(password, found?.passwordHash ?? null);

  recordLogin(username, ok);

  if (!ok || !found) {
    throw new HttpError(401, 'Wrong username or password', 'wrong_credentials');
  }

  const { passwordHash: _, ...user } = found;

  startSession(res, user.id);
  res.json(user);
});

authRouter.post('/logout', (req, res) => {
  endSession(req, res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (_req, res) => {
  res.json(currentUser(res));
});

authRouter.patch('/me', requireAuth, (req, res) => {
  const patch = parse(
    z.object({ displayName: z.string().trim().min(1).max(60).optional(), shareAnonymously: z.boolean().optional() }),
    req.body,
  );

  res.json(updateUser(currentUser(res).id, patch));
});

authRouter.post('/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = parse(
    z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }),
    req.body,
  );
  const user = currentUser(res);

  if (!checkPassword(currentPassword, getPasswordHash(user.id))) {
    throw new HttpError(400, 'Current password is wrong', 'wrong_current_password');
  }

  setPasswordHash(user.id, hashPassword(newPassword));
  endOtherSessions(req, user.id);
  res.status(204).end();
});

authRouter.delete('/me', requireAuth, (req, res) => {
  const { password } = parse(z.object({ password: z.string().min(1) }), req.body);
  const user = currentUser(res);

  if (!checkPassword(password, getPasswordHash(user.id))) {
    throw new HttpError(400, 'Password is wrong', 'wrong_password');
  }

  deleteUser(user.id);
  endSession(req, res);
  res.status(204).end();
});
