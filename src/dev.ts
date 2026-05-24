import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

interface ManagedProcess {
    child: ChildProcess;
    name: string;
}

const viteCliPath = path.resolve(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
const viteNodeCliPath = path.resolve(process.cwd(), 'node_modules', 'vite-node', 'vite-node.mjs');

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

const main = async (): Promise<void> => {
    const managedProcesses = [
        spawnManagedProcess('API server', [viteNodeCliPath, 'src/server/server.cli.ts']),
        spawnManagedProcess('Vite dev server', [viteCliPath]),
    ];
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

    for (const managedProcess of managedProcesses) {
        managedProcess.child.on('exit', (code, signal) => {
            if (shuttingDown) {
                return;
            }

            const exitCode = code ?? (signal == null ? 1 : 0);
            if (exitCode !== 0) {
                console.error(`${managedProcess.name} exited unexpectedly.`);
                void stopAll(exitCode);
            }
        });
        managedProcess.child.on('error', (error) => {
            if (shuttingDown) {
                return;
            }

            console.error(`Failed to start ${managedProcess.name}.`, error);
            void stopAll(1);
        });
    }

    await new Promise<void>(() => undefined);
};

void main().catch((error: unknown) => {
    console.error('Failed to start development processes.', error);
    process.exit(1);
});
