import { useState, useEffect, useCallback } from 'react';
import { useSettingsQuery } from '@/client/api/index.js';
import { SettingDto } from '@/dto/index.js';
import { Modal } from '../Modal.js';
import { Button } from '../Button.js';
import { SettingsSection } from './SettingsSection.js';
import { SettingField } from './SettingField.js';
import styles from './SettingsModal.module.css';

interface SettingsModalProps {
    show: boolean;
    onClose: () => void;
}

/**
 * Modal that loads all user-configurable settings and renders them grouped by
 * section. Each input component saves independently on blur (or on change for
 * booleans). The close button and background click are suppressed while any
 * field is saving or has a validation error.
 */
export const SettingsModal = ({ show, onClose }: SettingsModalProps) => {
    const query = useSettingsQuery();
    const [errorKeys, setErrorKeys] = useState<Set<string>>(new Set());
    const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());

    const isBlocked = savingKeys.size > 0 || errorKeys.size > 0;

    // Clear tracked state whenever the modal is dismissed so stale entries do
    // not carry over to the next open.
    useEffect(() => {
        if (!show) {
            setErrorKeys(new Set());
            setSavingKeys(new Set());
        }
    }, [show]);

    const handleValidationChange = useCallback((key: string, hasError: boolean) => {
        setErrorKeys(prev => {
            const next = new Set(prev);
            if (hasError) { next.add(key); } else { next.delete(key); }
            return next;
        });
    }, []);

    const handleSavingChange = useCallback((key: string, isSaving: boolean) => {
        setSavingKeys(prev => {
            const next = new Set(prev);
            if (isSaving) { next.add(key); } else { next.delete(key); }
            return next;
        });
    }, []);

    const sections = groupBySection(query.data ?? []);

    return (
        <Modal show={show} onClickBackground={isBlocked ? undefined : onClose}>
            <div className={styles.modalContent}>
                <header className={styles.header}>
                    <span className={styles.title}>Settings</span>
                    <Button variant='secondary' onClick={onClose} disabled={isBlocked} aria-label='Close settings'>
                        ×
                    </Button>
                </header>
                <div className={styles.body}>
                    {query.isLoading && <p className={styles.loadStatus}>Loading settings…</p>}
                    {query.isError && <p className={styles.loadStatus}>Failed to load settings.</p>}
                    {sections.map(([section, settings]) => (
                        <SettingsSection key={section} heading={section}>
                            {settings.map(setting => (
                                <SettingField
                                    key={setting.key}
                                    setting={setting}
                                    onValidationChange={handleValidationChange}
                                    onSavingChange={handleSavingChange}
                                />
                            ))}
                        </SettingsSection>
                    ))}
                </div>
            </div>
        </Modal>
    );
};

/** Groups settings by section while preserving server-defined order. */
const groupBySection = (settings: SettingDto[]): [string, SettingDto[]][] => {
    const map = new Map<string, SettingDto[]>();
    for (const setting of settings) {
        const group = map.get(setting.section) ?? [];
        group.push(setting);
        map.set(setting.section, group);
    }
    return [...map.entries()];
};
