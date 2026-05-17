import { useRunsMutation } from '@/client/v2/api/index.js';
import { useSessionContext } from '../SessionContext/index.js';

export const useRun = () => {
    const { activeSessions, activeTabState } = useSessionContext();
    const runsMutation = useRunsMutation();

    const mode = activeTabState.key;
    const sessionId = activeSessions[mode]?.id;

    return async (prompt: string, retrievalTurnLimit: number, includePartyContext: boolean) => {
        const res = await runsMutation.mutateAsync({
            sessionId,
            mode,
            prompt,
            retrievalTurnLimit,
            includePartyContext,
        });

    };
};