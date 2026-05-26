import { spawn, ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';

interface ManagedProcess {
    child: ChildProcess;
    name: string;
}

const viteCliPath = path.resolve(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
const viteNodeCliPath = path.resolve(process.cwd(), 'node_modules', 'vite-node', 'vite-node.mjs');

const serverPort = (() => {
    const raw = process.env['EQA_SERVER_PORT'];
    if (raw == null) return 3001;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : 3001;
})();

const spawnManagedProcess = (
    name: string,
    args: string[],
): ManagedProcess => ({
    child: spawn(process.execPath, args, {
        cwd: process.cwd(),
        stdio: 'inherit',
    }),
    name,
});

const waitForChildExit = (child: ChildProcess): Promise<void> => {
    if (child.exitCode != null) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const timeout = setTimeout(resolve, 5000);
        child.once('exit', () => {
            clearTimeout(timeout);
            resolve();
        });
    });
};

/**
 * Polls the given TCP port at 250ms intervals until it accepts a connection,
 * indicating the server process is ready to handle requests. Rejects if the
 * port does not open within timeoutMs (default 30s).
 */
const waitForPort = (port: number, timeoutMs = 30_000): Promise<void> => new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    const attempt = () => {
        const socket = createConnection({ port, host: '127.0.0.1' });
        socket.once('connect', () => {
            socket.destroy();
            resolve();
        });
        socket.once('error', () => {
            socket.destroy();
            if (Date.now() >= deadline) {
                reject(new Error(`Timed out after ${timeoutMs}ms waiting for port ${port}`));
                return;
            }
            setTimeout(attempt, 250);
        });
    };

    attempt();
});

const main = async (): Promise<void> => {
    const managedProcesses: ManagedProcess[] = [];
    let shuttingDown = false;

    const stopAll = async (exitCode: number): Promise<void> => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;

        for (const managedProcess of managedProcesses) {
            if (managedProcess.child.exitCode == null && !managedProcess.child.killed) {
                managedProcess.child.kill('SIGTERM');
            }
        }

        await Promise.all(managedProcesses.map(({ child }) => waitForChildExit(child)));
        process.exit(exitCode);
    };

    process.on('SIGINT', () => {
        void stopAll(0);
    });
    process.on('SIGTERM', () => {
        void stopAll(0);
    });

    const addManagedProcess = (p: ManagedProcess): void => {
        managedProcesses.push(p);
        p.child.on('exit', (code, signal) => {
            if (shuttingDown) return;
            const exitCode = code ?? (signal == null ? 1 : 0);
            if (exitCode !== 0) {
                console.error(`${p.name} exited unexpectedly.`);
                void stopAll(exitCode);
            }
        });
        p.child.on('error', (error) => {
            if (shuttingDown) return;
            console.error(`Failed to start ${p.name}.`, error);
            void stopAll(1);
        });
    };

    addManagedProcess(spawnManagedProcess('API server', [viteNodeCliPath, 'src/server/server.cli.ts']));

    await waitForPort(serverPort);

    addManagedProcess(spawnManagedProcess('Vite dev server', [viteCliPath]));

    await new Promise<void>(() => undefined);
};

void main().catch((error: unknown) => {
    console.error('Failed to start development processes.', error);
    process.exit(1);
});
