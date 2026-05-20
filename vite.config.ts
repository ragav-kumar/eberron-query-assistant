import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import checker from 'vite-plugin-checker';

import { eberronApiPlugin } from './src/server/vite-plugin.js';
import { resolveV2ServerPort } from './src/server/v2/server-config.js';

const v2ServerTarget = `http://127.0.0.1:${resolveV2ServerPort()}`;

export default defineConfig({
  plugins: [
    eberronApiPlugin(),
    react(),
    checker({
      typescript: true,
      eslint: {
        lintCommand: 'eslint .'
      }
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    proxy: {
      '/api/v2': {
        target: v2ServerTarget
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
