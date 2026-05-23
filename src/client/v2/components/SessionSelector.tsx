import { useSessionContext } from './SessionContext/index.js';
import { TEMP_SESSION_ID } from './SessionContext/SessionProvider.js';
import { SessionMode } from '@/dto/index.js';
import styles from './SessionSelector.module.css';
import { ChangeEvent } from 'react';
import { Button } from './Button.js';

interface SessionSelectorProps {
    mode: SessionMode;
}

export const SessionSelector = ({mode}:SessionSelectorProps) => {
    const { sessionsByMode, activeSessions, changeActiveSession, createTempSession } = useSessionContext();
    const sessions = sessionsByMode(mode);
    const activeSession = activeSessions[mode];

    const changeSession = (e: ChangeEvent<HTMLSelectElement>) => {
        const sessionId = e.target.value;
        changeActiveSession(sessionId, mode);
    };

    return (
        <div
            id={`session-selector-${mode}`}
            className={styles.wrap}
        >
            <select
                id={`session-selector-${mode}-select`}
                className={styles.dropdown}
                value={activeSession?.id}
                onChange={changeSession}
            >
                {activeSession?.id === TEMP_SESSION_ID && (
                    <option value={TEMP_SESSION_ID}>Untitled (new session)</option>
                )}
                {sessions.map(session => (
                    <option
                        key={session.id}
                        value={session.id}
                    >
                        {session.createdAt} - {session.title} ({session.sessionEntryCount})
                    </option>
                ))}
            </select>
            <Button
                variant='primary'
                onClick={() => createTempSession(mode)}
            >
                New session
            </Button>
        </div>
    );
};
