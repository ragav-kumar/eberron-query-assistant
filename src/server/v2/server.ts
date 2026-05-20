import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
    createV2App,
    type CreateV2AppDependencies,
} from './app.js';
import { createV2ApiHandler } from './api/index.js';
import {
    DEFAULT_V2_SERVER_HOST,
    resolveV2ServerPort,
} from './server-config.js';

export interface V2ServerRuntime {
    close: () => Promise<void>;
    handleRequest: (request: IncomingMessage, response: ServerResponse) => void;
}

export interface StartedV2Server {
    close: () => Promise<void>;
    host: string;
    port: number;
    runtime: V2ServerRuntime;
    server: Server;
}

export interface StartV2ServerOptions {
    appDependencies?: CreateV2AppDependencies;
    host?: string;
    port?: number;
    runtime?: V2ServerRuntime;
}

export const createV2ServerRuntime = async (
    dependencies: CreateV2AppDependencies = {},
): Promise<V2ServerRuntime> => {
    const app = await createV2App(dependencies);

    return {
        close: app.close,
        handleRequest: createV2ApiHandler(app),
    };
};

export const createV2RequestListener = (
    runtime: V2ServerRuntime,
) => (request: IncomingMessage, response: ServerResponse): void => {
    if (request.url?.startsWith('/api/v2/')) {
        runtime.handleRequest(request, response);
        return;
    }

    response.statusCode = 404;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ error: 'Unknown API route.' }));
};

export const startV2Server = async (
    options: StartV2ServerOptions = {},
): Promise<StartedV2Server> => {
    const runtime = options.runtime ?? await createV2ServerRuntime(options.appDependencies);
    const host = options.host ?? DEFAULT_V2_SERVER_HOST;
    const requestedPort = options.port ?? resolveV2ServerPort();
    const server = createServer(createV2RequestListener(runtime));

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
