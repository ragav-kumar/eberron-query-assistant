import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Plugin } from 'vite';

import { formatThrownValue } from '../errors.js';

interface WebAppLike {
  startStartupRefresh(): void;
}

interface BusyErrorLike {
  kind: 'busy';
  operation: string;
}

interface WebOperationErrorLike {
  console: unknown;
  kind: 'web-operation';
  providerDebug?: unknown;
}

type HandleV1ApiRequest = (
  app: WebAppLike,
  request: IncomingMessage,
  response: ServerResponse
) => Promise<void>;

interface V1Runtime {
  app: WebAppLike;
  handleV1ApiRequest: HandleV1ApiRequest;
}

interface V1AppModule {
  createWebApp: () => WebAppLike;
}

interface V1ApiModule {
  handleV1ApiRequest: HandleV1ApiRequest;
}

export const eberronApiPlugin = (): Plugin => ({
    name: 'eberron-api',
    configureServer: (server) => {
      let v1RuntimePromise: Promise<V1Runtime> | null = null;

      const loadV1Runtime = async (): Promise<V1Runtime> => {
        if (v1RuntimePromise) {
          return v1RuntimePromise;
        }

        v1RuntimePromise = Promise.all([
          server.ssrLoadModule('/src/server/v1/app.ts'),
          server.ssrLoadModule('/src/server/v1/api.ts')
        ]).then((loadedModules) => {
          const [appModule, apiModule] = loadedModules as [V1AppModule, V1ApiModule];
          const app = appModule.createWebApp();
          app.startStartupRefresh();

          return {
            app,
            handleV1ApiRequest: apiModule.handleV1ApiRequest
          };
        });

        return v1RuntimePromise;
      };

      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith('/api/')) {
          next();
          return;
        }

        const url = new URL(request.url, 'http://localhost');
        if (url.pathname.startsWith('/api/v2/')) {
          next();
          return;
        }

        void Promise.resolve()
          .then(async () => {
            if (url.pathname.startsWith('/api/v1/')) {
              const { app, handleV1ApiRequest } = await loadV1Runtime();
              await handleV1ApiRequest(app, request, response);
              return;
            }

            writeJson(response, 404, { error: 'Unknown API route.' });
          })
          .catch((error: unknown) => {
            writeJson(response, isBusyError(error) ? 409 : 500, {
              error: formatThrownValue(error),
              ...(isBusyError(error) ? { operation: error.operation } : {}),
              ...(isWebOperationError(error) ? {
                console: error.console,
                ...(error.providerDebug ? { providerDebug: error.providerDebug } : {})
              } : {})
            });
          });
      });
    }
  });

const isBusyError = (error: unknown): error is BusyErrorLike => (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    error.kind === 'busy' &&
    'operation' in error &&
    typeof error.operation === 'string'
  );

const isWebOperationError = (error: unknown): error is WebOperationErrorLike => (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    error.kind === 'web-operation' &&
    'console' in error
  );

const writeJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
};
