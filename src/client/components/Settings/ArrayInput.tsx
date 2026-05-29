import { useState } from 'react';
import { ArraySettingDto } from '@/dto/index.js';
import { joinClassNames } from '@/client/utils.js';
import { useSettingInput } from './useSettingInput.js';
import styles from './SettingsModal.module.css';

interface ArrayInputProps {
    setting: ArraySettingDto;
    onSavingChange: (key: string, isSaving: boolean) => void;
    onValidationChange: (key: string, hasError: boolean) => void;
}

/**
 * Textarea that represents a string array as one entry per line. Blank lines
 * are stripped before saving. After a successful save the displayed text is
 * normalized to match the server-confirmed array.
 */
export const ArrayInput = ({ setting, onSavingChange, onValidationChange }: ArrayInputProps) => {
    const toText = (arr: string[]) => arr.join('\n');
    const [localText, setLocalText] = useState(toText(setting.value));
    const [confirmedText, setConfirmedText] = useState(toText(setting.value));
    const { mutation, statusText } = useSettingInput({ settingKey: setting.key, onSavingChange, onValidationChange });

    const handleBlur = () => {
        if (localText === confirmedText || mutation.isPending) return;
        const valueArray = localText.split('\n').map(s => s.trim()).filter(Boolean);
        mutation.mutate({ ...setting, value: valueArray }, {
            onSuccess: data => {
                if (data.settingType === 'array') {
                    const normalized = toText(data.value);
                    setConfirmedText(normalized);
                    setLocalText(normalized);
                }
            },
        });
    };

    return (
        <>
            <textarea
                id={setting.key}
                className={joinClassNames(styles.input, styles.textarea)}
                value={localText}
                onChange={e => setLocalText(e.target.value)}
                onBlur={handleBlur}
            />
            <span className={styles.fieldStatus}>{statusText}</span>
        </>
    );
};
