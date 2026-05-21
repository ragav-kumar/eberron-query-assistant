import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Plugin } from 'vite';

export const eberronApiPlugin = (): Plugin => ({
    name: 'eberron-api',
    configureServer: (server) => {
      server.middlewares.use((request: IncomingMessage, response: ServerResponse, next) => {
        if (!request.url?.startsWith('/api/')) {
          next();
          return;
        }

        const url = new URL(request.url, 'http://localhost');
        if (url.pathname.startsWith('/api/v2/')) {
          next();
          return;
        }

        writeJson(response, 404, { error: 'Unknown API route.' });
      });
    },
  });

const writeJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
};
