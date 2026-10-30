import { readFileSync } from 'node:fs';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * The site-wide headers from public/_headers, so `npm run preview` runs the production build under
 * the same security policy as the real site.
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

/**
 * GitHub Pages can't send headers, so the build also carries the security policy as <meta> tags.
 * frame-ancestors is dropped there: browsers ignore it in a <meta>.
 */
function policyMeta(): Plugin {
  const headers = siteHeaders();
  const csp = headers['Content-Security-Policy']
    .split(';')
    .map(d => d.trim())
    .filter(d => d && !d.startsWith('frame-ancestors'))
    .join('; ');

  return {
    name: 'policy-meta',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' },
      { tag: 'meta', attrs: { name: 'referrer', content: headers['Referrer-Policy'] }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig({
  // GitHub Pages serves the site under /<repository>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), policyMeta()],
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
