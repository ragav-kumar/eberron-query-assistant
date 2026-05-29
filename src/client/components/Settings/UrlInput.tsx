import { useState } from 'react';
import { UrlSettingDto } from '@/dto/index.js';
import { joinClassNames } from '@/client/utils.js';
import { useSettingInput } from './useSettingInput.js';
import styles from './SettingsModal.module.css';

interface UrlInputProps {
    setting: UrlSettingDto;
    onSavingChange: (key: string, isSaving: boolean) => void;
    onValidationChange: (key: string, hasError: boolean) => void;
}

const isValidUrl = (value: string): boolean => {
    if (!value.trim()) return true; // empty is allowed (clears the setting)
    try { new URL(value); return true; } catch { return false; }
};

/**
 * URL input with format validation. A non-empty value that fails URL parsing is
 * flagged as an error and blocks save. An empty value is allowed (clears the setting).
 */
export const UrlInput = ({ setting, onSavingChange, onValidationChange }: UrlInputProps) => {
    const [localValue, setLocalValue] = useState(setting.value);
    const [confirmedValue, setConfirmedValue] = useState(setting.value);
    const hasError = !isValidUrl(localValue);
    const { mutation, statusText } = useSettingInput({
        settingKey: setting.key, hasError, errorText: 'Enter a valid URL', onSavingChange, onValidationChange,
    });

    const handleBlur = () => {
        if (hasError || localValue === confirmedValue || mutation.isPending) return;
        mutation.mutate({ ...setting, value: localValue }, { onSuccess: () => setConfirmedValue(localValue) });
    };

    return (
        <>
            <input
                id={setting.key}
                type='url'
                className={styles.input}
                value={localValue}
                placeholder={setting.placeholder}
                aria-invalid={hasError || undefined}
                onChange={e => setLocalValue(e.target.value)}
                onBlur={handleBlur}
            />
            <span className={joinClassNames(styles.fieldStatus, hasError ? styles.fieldStatusError : undefined)}>
                {statusText}
            </span>
        </>
    );
};
