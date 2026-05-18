export interface ConsoleEventPublisher {
    /**
     * TODO: Replace this stub with a real process-local publisher that:
     * - keeps subscriber sets for live console listeners
     * - optionally mirrors entries into consoleEntries persistence
     * - replays initial console state when appropriate
     * - pushes ConsoleEntryDto payloads over the SSE stream
     */
    registerConnection(): void;
    warn(message: string): void;
}

export const createConsoleEventPublisher = (): ConsoleEventPublisher => ({
    registerConnection: () => {
        // TODO: Register live console subscribers once the console publisher is wired up.
        console.warn('GET /api/v2/events/console is not implemented');
    },
    warn: message => {
        console.warn(message);
    },
});
