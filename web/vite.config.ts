/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend REST API path prefixes the SPA calls (see src/app.ts). Each is
// forwarded to the Express server during local dev so the browser talks to a
// single origin — the HTTP-only session cookie rides along without CORS, since
// the backend has no CORS middleware. For a co-hosted or otherwise-located API,
// set VITE_API_BASE_URL instead of relying on this proxy.
const apiPrefixes = [
  '/auth',
  '/leagues',
  '/public',
  '/teams',
  '/players',
  '/games',
  '/statistics',
  '/seasons',
  '/playoff-rounds',
  '/scopes',
  '/health',
];

const apiTarget = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      apiPrefixes.map((prefix) => [prefix, { target: apiTarget, changeOrigin: true }]),
    ),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
