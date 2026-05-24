import {
    startServer,
    StartedServer,
} from './server.js';

const registerShutdownHandlers = (startedServer: StartedServer): void => {
    let shuttingDown = false;

    const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;

        try {
            console.info(`Stopping API server after ${signal}.`);
            await startedServer.close();
            process.exit(0);
        } catch (error) {
            console.error('Failed to stop API server cleanly.', error);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => {
        void shutdown('SIGINT');
    });
    process.on('SIGTERM', () => {
        void shutdown('SIGTERM');
    });
};

const main = async (): Promise<void> => {
    const startedServer = await startServer();
    console.info(`API server listening at http://${startedServer.host}:${startedServer.port}`);
    registerShutdownHandlers(startedServer);
};

void main().catch((error: unknown) => {
    console.error('Failed to start API server.', error);
    process.exit(1);
});
