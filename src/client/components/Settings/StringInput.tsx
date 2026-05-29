import { useState } from 'react';
import { StringSettingDto } from '@/dto/index.js';
import { useSettingInput } from './useSettingInput.js';
import styles from './SettingsModal.module.css';

interface StringInputProps {
    setting: StringSettingDto;
    onSavingChange: (key: string, isSaving: boolean) => void;
    onValidationChange: (key: string, hasError: boolean) => void;
}

/** Plain text input for a string setting. Saves on blur when the value has changed from the last server-confirmed state. */
export const StringInput = ({ setting, onSavingChange, onValidationChange }: StringInputProps) => {
    const [localValue, setLocalValue] = useState(setting.value);
    const [confirmedValue, setConfirmedValue] = useState(setting.value);
    const { mutation, statusText } = useSettingInput({ settingKey: setting.key, onSavingChange, onValidationChange });

    const handleBlur = () => {
        if (localValue === confirmedValue || mutation.isPending) return;
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
                onChange={e => setLocalValue(e.target.value)}
                onBlur={handleBlur}
            />
            <span className={styles.fieldStatus}>{statusText}</span>
        </>
    );
};
