// Cloudflare Pages Function for every /api/auth/* request: the lasting Google sign-in in server/auth.ts.
// Settings (Cloudflare project → Settings → Variables and secrets): VITE_GOOGLE_CLIENT_ID and the
// secret GOOGLE_CLIENT_SECRET.

import { handleAuth, type AuthEnv } from '../../../server/auth';

export const onRequest = (context: { request: Request; env: AuthEnv }) => handleAuth(context.request, context.env);
