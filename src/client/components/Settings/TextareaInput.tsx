import { useState } from 'react';
import { TextareaSettingDto } from '@/dto/index.js';
import { joinClassNames } from '@/client/utils.js';
import { useSettingInput } from './useSettingInput.js';
import styles from './SettingsModal.module.css';

interface TextareaInputProps {
    setting: TextareaSettingDto;
    onSavingChange: (key: string, isSaving: boolean) => void;
    onValidationChange: (key: string, hasError: boolean) => void;
}

/** Resizable textarea for a long-form string setting. Saves on blur when the value has changed from the last server-confirmed state. */
export const TextareaInput = ({ setting, onSavingChange, onValidationChange }: TextareaInputProps) => {
    const [localValue, setLocalValue] = useState(setting.value);
    const [confirmedValue, setConfirmedValue] = useState(setting.value);
    const { mutation, statusText } = useSettingInput({ settingKey: setting.key, onSavingChange, onValidationChange });

    const handleBlur = () => {
        if (localValue === confirmedValue || mutation.isPending) return;
        mutation.mutate({ ...setting, value: localValue }, { onSuccess: () => setConfirmedValue(localValue) });
    };

    return (
        <>
            <textarea
                id={setting.key}
                className={joinClassNames(styles.input, styles.textarea)}
                value={localValue}
                onChange={e => setLocalValue(e.target.value)}
                onBlur={handleBlur}
            />
            <span className={styles.fieldStatus}>{statusText}</span>
        </>
    );
};
