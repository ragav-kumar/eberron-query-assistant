import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
    createApp,
    type CreateAppDependencies,
} from './app.js';
import { createApiHandler } from './api/index.js';
import {
    DEFAULT_SERVER_HOST,
    resolveServerPort,
} from './server-config.js';

export interface ServerRuntime {
    close: () => Promise<void>;
    handleRequest: (request: IncomingMessage, response: ServerResponse) => void;
}

export interface StartedServer {
    close: () => Promise<void>;
    host: string;
    port: number;
    runtime: ServerRuntime;
    server: Server;
}

export interface StartServerOptions {
    appDependencies?: CreateAppDependencies;
    host?: string;
    port?: number;
    runtime?: ServerRuntime;
}

export const createServerRuntime = async (
    dependencies: CreateAppDependencies = {},
): Promise<ServerRuntime> => {
    const app = await createApp(dependencies);

    return {
        close: app.close,
        handleRequest: createApiHandler(app),
    };
};

export const createRequestListener = (
    runtime: ServerRuntime,
) => (request: IncomingMessage, response: ServerResponse): void => {
    if (request.url?.startsWith('/api/v2/')) {
        runtime.handleRequest(request, response);
        return;
    }

    response.statusCode = 404;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ error: 'Unknown API route.' }));
};

export const startServer = async (
    options: StartServerOptions = {},
): Promise<StartedServer> => {
    const runtime = options.runtime ?? await createServerRuntime(options.appDependencies);
    const host = options.host ?? DEFAULT_SERVER_HOST;
    const requestedPort = options.port ?? resolveServerPort();
    const server = createServer(createRequestListener(runtime));

    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(requestedPort, host, () => {
                server.off('error', reject);
                resolve();
            });
        });
    } catch (error) {
        await runtime.close();
        throw error;
    }

    const address = server.address();
    if (address == null || typeof address === 'string') {
        await new Promise<void>((resolve, reject) => {
            server.close((closeError) => {
                if (closeError) {
                    reject(closeError);
                    return;
                }
                resolve();
            });
        });
        await runtime.close();
        throw new Error('V2 server did not report a TCP address.');
    }

    let closed = false;
    return {
        close: async () => {
            if (closed) {
                return;
            }
            closed = true;
            await new Promise<void>((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                });
            });
            await runtime.close();
        },
        host,
        port: address.port,
        runtime,
        server,
    };
};
