import { useRunsMutation } from '@/client/v2/api/index.js';
import { useSessionContext } from '../SessionContext/index.js';
import { TEMP_SESSION_ID } from '../SessionContext/SessionProvider.js';
import { tabDefinitions } from '../SessionContext/tabDefinitions.js';

/**
 * Returns a no-arg async function that submits the current tab input as a run.
 * When the active session is a UI-local temporary session, the run is submitted
 * without a sessionId so the server creates a durable session inline. On
 * success the temp session is promoted to the real persisted session.
 */
export const useRun = () => {
    const { activeSessions, activeTabState, patchActiveTabState, promoteSession } = useSessionContext();
    const runsMutation = useRunsMutation();

    const mode = activeTabState.key;
    const sessionId = activeSessions[mode]?.id;
    const isTempSession = sessionId === TEMP_SESSION_ID;

    return async () => {
        try {
            const res = await runsMutation.mutateAsync({
                ...tabDefinitions[mode].buildRun(activeTabState),
                sessionId: isTempSession ? undefined : sessionId,
            });
            if (isTempSession) {
                promoteSession(mode, res.sessionId);
            }
            patchActiveTabState({ prompt: '' });
        } catch (error) {
            console.error('Run failed:', error);
        }
    };
};
