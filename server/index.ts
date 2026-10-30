import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import express from 'express';

import { requireAuth } from './auth';
import { startBenchmarkSchedule } from './benchmarkSync';
import { DB_PATH } from './db';
import { errorHandler } from './http';
import { authRouter } from './routes/auth';
import { dataRouter } from './routes/data';
import { fundsRouter } from './routes/funds';

// API_PORT wins so a PORT meant for the Vite dev server (or another tool) doesn't hijack the API.
const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);
const isProd = process.env.NODE_ENV === 'production';
const app = express();

app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');

  if (isProd) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
    );
  }

  next();
});
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.use('/api/auth', authRouter);
app.use('/api/funds', requireAuth, fundsRouter);
app.use('/api', requireAuth, dataRouter);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found', code: 'not_found' });
});

// In production the API also serves the built client.
const dist = resolve('dist');

if (isProd && existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('/{*path}', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(resolve(dist, 'index.html'));
  });
}

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Yielder API on http://localhost:${PORT}  (db: ${DB_PATH})`);
  startBenchmarkSchedule();
});
