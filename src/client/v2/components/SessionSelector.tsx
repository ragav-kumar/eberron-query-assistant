import { useSessionContext } from './SessionContext/index.js';
import { SessionMode } from '@/dto/index.js';
import styles from './SessionSelector.module.css';
import { ChangeEvent } from 'react';
import { Button } from './Button.js';

interface SessionSelectorProps {
    mode: SessionMode;
}

export const SessionSelector = ({mode}:SessionSelectorProps) => {
    const { sessionsByMode, activeSessions, changeActiveSession } = useSessionContext();
    const sessions = sessionsByMode(mode);
    const activeSession = activeSessions[mode];

    const changeSession = (e: ChangeEvent<HTMLSelectElement>) => {
        const sessionId = e.target.value;
        changeActiveSession(mode, sessionId as SessionMode);
    };

    const createNewSession = () => {
        // TODO
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
                {sessions.map(session => (
                    <option
                        key={session.id}
                        value={session.id}
                    >
                        {session.createdAt} - {session.title}
                    </option>
                ))}
            </select>
            <Button
                variant='primary'
                onClick={createNewSession}
            >
                New session
            </Button>
        </div>
    );
};