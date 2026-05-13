import { useSessionContext } from './SessionContext/index.js';
import { Button } from './Button.js';
import styles from './Input.module.css';

export const Input = () => {
    const {isBusy, submitActiveTab, activeTabState, patchActiveTabState} = useSessionContext();

    return (
        <div className={styles.wrap}>
            <label className={styles.checkboxLabel}>
                <input
                    type="checkbox"
                    id="include-party-context"
                    className={styles.checkbox}
                    checked={activeTabState.includePartyContext}
                    onChange={(e) => patchActiveTabState({includePartyContext: e.target.checked})}
                />
                <span>Include party context</span>
            </label>
            <label htmlFor="retrieval-turn-limit" className={styles.label}>
                Extra retrieval turns: {activeTabState.retrievalTurnLimit}
            </label>
            <input
                type="range"
                id="retrieval-turn-limit"
                className={styles.slider}
                min="0"
                max="3"
                value={activeTabState.retrievalTurnLimit}
                onChange={(e) => patchActiveTabState({retrievalTurnLimit: Number(e.target.value)})}
            />
            <label htmlFor="prompt" className={styles.label}>
                Prompt
            </label>
            <textarea
                id="prompt"
                className={styles.input}
                rows={8}
                value={activeTabState.prompt}
                onChange={(e) => patchActiveTabState({prompt: e.target.value})}
                placeholder="Ask about Eberron lore, campaign notes, PDFs, or articles."
            />
            <Button
                variant="primary"
                className={styles.button}
                disabled={isBusy}
                onClick={void submitActiveTab}
            >
                Submit
            </Button>
        </div>
    );
};
