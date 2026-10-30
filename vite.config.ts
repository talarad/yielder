import { readFileSync } from 'node:fs';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The site-wide headers from public/_headers (what Cloudflare Pages sends), so `npm run preview`
 * runs the production build under the same security policy as the real site.
 */
function siteHeaders(): Record<string, string> {
  const block = readFileSync('public/_headers', 'utf8').split(/\r?\n\r?\n/).find(b => /^\/\*\s*$/m.test(b)) ?? '';

  return Object.fromEntries(
    block
      .split(/\r?\n/)
      .filter(line => /^\s+\S+:/.test(line))
      .map(line => {
        const i = line.indexOf(':');

        return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
      }),
  );
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
    headers: siteHeaders(),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
          charts: ['recharts'],
        },
      },
    },
  },
});
