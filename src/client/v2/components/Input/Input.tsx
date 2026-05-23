import { useSessionContext } from '../SessionContext/index.js';
import { TEMP_SESSION_ID } from '../SessionContext/SessionProvider.js';
import { Button } from '../Button.js';
import styles from './Input.module.css';
import { useRun } from './useRun.js';

export const Input = () => {
    const { isBusy, activeTabState, patchActiveTabState, activeSessions } = useSessionContext();
    const submit = useRun();
    const activeSession = activeSessions[activeTabState.key];
    // A real persisted session (not the temp sentinel) means a run has already been submitted.
    const isPartyContextLocked = activeSession != null && activeSession.id !== TEMP_SESSION_ID;

    return (
        <div className={styles.wrap}>
            <label className={styles.checkboxLabel}>
                <input
                    type='checkbox'
                    id='include-party-context'
                    className={styles.checkbox}
                    checked={activeTabState.includePartyContext}
                    disabled={isPartyContextLocked}
                    onChange={(e) => patchActiveTabState({includePartyContext: e.target.checked})}
                />
                <span>Include party context</span>
            </label>
            <label htmlFor='retrieval-turn-limit' className={styles.label}>
                Extra retrieval turns: {activeTabState.retrievalTurnLimit}
            </label>
            <input
                type='range'
                id='retrieval-turn-limit'
                className={styles.slider}
                min='0'
                max='3'
                value={activeTabState.retrievalTurnLimit}
                onChange={(e) => patchActiveTabState({retrievalTurnLimit: Number(e.target.value)})}
            />
            <label htmlFor='prompt' className={styles.label}>
                Prompt
            </label>
            <textarea
                id='prompt'
                className={styles.input}
                rows={8}
                value={activeTabState.prompt}
                onChange={(e) => patchActiveTabState({prompt: e.target.value})}
                placeholder='Ask about Eberron lore, campaign notes, PDFs, or articles.'
            />
            <Button
                variant='primary'
                className={styles.button}
                disabled={isBusy}
                onClick={() => void submit()}
            >
                Submit
            </Button>
        </div>
    );
};
