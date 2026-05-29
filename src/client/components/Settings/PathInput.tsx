import { useState } from 'react';
import { PathSettingDto } from '@/dto/index.js';
import { joinClassNames } from '@/client/utils.js';
import { useSettingInput } from './useSettingInput.js';
import styles from './SettingsModal.module.css';

interface PathInputProps {
    setting: PathSettingDto;
    onSavingChange: (key: string, isSaving: boolean) => void;
    onValidationChange: (key: string, hasError: boolean) => void;
}

/** Characters forbidden in Windows path components (and inadvisable elsewhere). */
const FORBIDDEN = /[\0<>:"|?*]/;

/**
 * Validates that `value` is a non-empty relative filesystem path.
 * Accepts both `/` and `\` as separators. Rejects absolute paths (leading
 * `/`, `\`, or a Windows drive letter) and any segment containing characters
 * that are forbidden in Windows filenames.
 */
const validatePath = (value: string): { hasError: boolean; errorText: string } => {
    const trimmed = value.trim();
    if (!trimmed) {
        return { hasError: true, errorText: 'Path must not be empty' };
    }
    if (/^[/\\]/.test(trimmed) || /^[A-Za-z]:[/\\]/.test(trimmed)) {
        return { hasError: true, errorText: 'Path must be relative' };
    }
    const segments = trimmed.split(/[/\\]/).filter(Boolean);
    if (segments.some(seg => FORBIDDEN.test(seg))) {
        return { hasError: true, errorText: 'Path contains invalid characters' };
    }
    return { hasError: false, errorText: '' };
};

/** Text input for a relative filesystem path setting. Accepts `/` and `\` as separators. */
export const PathInput = ({ setting, onSavingChange, onValidationChange }: PathInputProps) => {
    const [localValue, setLocalValue] = useState(setting.value);
    const [confirmedValue, setConfirmedValue] = useState(setting.value);
    const { hasError, errorText } = validatePath(localValue);
    const { mutation, statusText } = useSettingInput({
        settingKey: setting.key, hasError, errorText, onSavingChange, onValidationChange,
    });

    const handleBlur = () => {
        if (hasError || localValue === confirmedValue || mutation.isPending) return;
        mutation.mutate({ ...setting, value: localValue }, { onSuccess: () => setConfirmedValue(localValue) });
    };

    return (
        <>
            <input
                id={setting.key}
                type='text'
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
