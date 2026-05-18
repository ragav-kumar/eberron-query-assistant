import type { CreateRunDto, RunDto } from '@/dto/index.js';

export interface RunCoordinator {
    /**
     * TODO: Replace this stub with a real coordinator that:
     * - creates or promotes sessions
     * - persists runs and session entries
     * - executes the assistant/NPC runtime by mode
     * - updates titles, activeRunId, and NPC persistence
     * - emits runtime and console events during the run lifecycle
     */
    startRun(request: CreateRunDto): Promise<RunDto>;
}

export const createRunCoordinator = (): RunCoordinator => ({
    startRun: (_request) => {
        // TODO: Replace this placeholder with real run creation and execution.
        console.warn('POST /api/v2/runs is not implemented');
        throw new Error('POST /api/v2/runs is not implemented');
    },
});
