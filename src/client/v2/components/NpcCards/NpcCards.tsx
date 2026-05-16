import { useSessionContext } from '../SessionContext/index.js';

export const NpcCards = () => {
    const { activeSession } = useSessionContext();

    if (activeSession?.mode !== 'npc') {
        // TODO: Replace with empty session output
        return null;
    }

    return (
        <p>TODO</p>
    );
};