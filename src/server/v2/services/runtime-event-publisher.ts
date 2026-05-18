export interface RuntimeEventPublisher {
    /**
     * TODO: Replace this stub with a real process-local publisher that:
     * - keeps subscriber sets for structured runtime listeners
     * - emits run, refresh, session-entry, and session events
     * - drives the client invalidation flow through typed SSE payloads
     */
    registerConnection(): void;
    warn(message: string): void;
}

export const createRuntimeEventPublisher = (): RuntimeEventPublisher => ({
    registerConnection: () => {
        // TODO: Register live runtime subscribers once the runtime publisher is wired up.
        console.warn('GET /api/v2/events/runtime is not implemented');
    },
    warn: message => {
        console.warn(message);
    },
});
