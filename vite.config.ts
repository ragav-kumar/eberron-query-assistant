import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type PluginOption } from 'vite';
import checker from 'vite-plugin-checker';

import { eberronApiPlugin } from './src/server/vite-plugin.js';

const createCheckerPlugin = checker as (options: {
  typescript: boolean;
  eslint: {
    lintCommand: string;
  };
}) => PluginOption;

// Read directly rather than importing from defaults.ts. That module validates mandatory
// keys (OPENAI_API_KEY, EQA_PARTY_ACTOR_UUIDS) at import time via Zod, and those keys
// live in .env — which Vite has not loaded yet when vite.config.ts is evaluated.
const serverHost = process.env['EQA_V2_SERVER_HOST'] ?? '127.0.0.1';
const serverPort = (() => {
  const raw = process.env['EQA_V2_SERVER_PORT'];
  if (raw == null) return 3001;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : 3001;
})();
const serverTarget = `http://${serverHost}:${serverPort}`;

export default defineConfig({
  plugins: [
    eberronApiPlugin(),
    react(),
    createCheckerPlugin({
      typescript: true,
      eslint: {
        lintCommand: 'eslint .'
      }
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@client': fileURLToPath(new URL('./src/client', import.meta.url)),
      '@server': fileURLToPath(new URL('./src/server', import.meta.url))
    }
  },
  server: {
    proxy: {
      '/api/v2': {
        target: serverTarget
      }
    },
    watch: {
      ignored: [
        '**/.eberron-query-assistant/**',
        '**/logs/**',
        '**/foundry-export/**',
        '**/pdf/**'
      ]
    },
    port: 3000,
    strictPort: true
  }
});
