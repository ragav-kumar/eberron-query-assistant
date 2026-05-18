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

type HandleV2ApiRequest = (
  request: IncomingMessage,
  response: ServerResponse
) => void;

interface V1Runtime {
  app: WebAppLike;
  handleV1ApiRequest: HandleV1ApiRequest;
}

interface V2Runtime {
  handleV2ApiRequest: HandleV2ApiRequest;
}

interface V1AppModule {
  createWebApp: () => WebAppLike;
}

interface V1ApiModule {
  handleV1ApiRequest: HandleV1ApiRequest;
}

interface V2ApiModule {
  handleV2ApiRequest: HandleV2ApiRequest;
}

interface V2AppModule {
  initializeV2App: () => Promise<void>;
}

export const eberronApiPlugin = (): Plugin => ({
    name: 'eberron-api',
    configureServer(server) {
      let v1RuntimePromise: Promise<V1Runtime> | null = null;
      let v2RuntimePromise: Promise<V2Runtime> | null = null;

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

      const loadV2Runtime = async (): Promise<V2Runtime> => {
        if (v2RuntimePromise) {
          return v2RuntimePromise;
        }

        v2RuntimePromise = Promise.all([
          server.ssrLoadModule('/src/server/v2/app.ts'),
          server.ssrLoadModule('/src/server/v2/api/index.ts')
        ]).then(async (loadedModules) => {
          const [appModule, apiModule] = loadedModules as [V2AppModule, V2ApiModule];
          await appModule.initializeV2App();

          return {
            handleV2ApiRequest: apiModule.handleV2ApiRequest
          };
        });

        return v2RuntimePromise;
      };

      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith('/api/')) {
          next();
          return;
        }

        const url = new URL(request.url, 'http://localhost');

        void Promise.resolve()
          .then(async () => {
            if (url.pathname.startsWith('/api/v1/')) {
              const { app, handleV1ApiRequest } = await loadV1Runtime();
              await handleV1ApiRequest(app, request, response);
              return;
            }

            if (url.pathname.startsWith('/api/v2/')) {
              const { handleV2ApiRequest } = await loadV2Runtime();
              handleV2ApiRequest(request, response);
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
