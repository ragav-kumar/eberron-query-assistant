import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type PluginOption } from 'vite';
import checker from 'vite-plugin-checker';

import { eberronApiPlugin } from './src/server/vite-plugin.js';
import {
  serverHost,
  serverPort
} from './src/server/v2/db/app/settings/defaults.js';

const createCheckerPlugin = checker as (options: {
  typescript: boolean;
  eslint: {
    lintCommand: string;
  };
}) => PluginOption;

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
      '@client': fileURLToPath(new URL('./src/client/v2', import.meta.url)),
      '@server': fileURLToPath(new URL('./src/server/v2', import.meta.url))
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
