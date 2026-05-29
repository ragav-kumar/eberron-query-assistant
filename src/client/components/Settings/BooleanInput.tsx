import { useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { BooleanSettingDto } from '@/dto/index.js';
import { useSettingInput } from './useSettingInput.js';
import styles from './SettingsModal.module.css';

interface BooleanInputProps {
    setting: BooleanSettingDto;
    onSavingChange: (key: string, isSaving: boolean) => void;
    onValidationChange: (key: string, hasError: boolean) => void;
}

/**
 * Toggle switch for a boolean setting using Radix UI Switch. Saves immediately
 * on change (no blur required). The label in SettingField is linked via htmlFor
 * so clicking it also toggles the switch.
 */
export const BooleanInput = ({ setting, onSavingChange, onValidationChange }: BooleanInputProps) => {
    const [checked, setChecked] = useState(setting.value);
    const { mutation, statusText } = useSettingInput({ settingKey: setting.key, onSavingChange, onValidationChange });

    const handleChange = (value: boolean) => {
        setChecked(value);
        mutation.mutate({ ...setting, value });
    };

    return (
        <>
            <Switch.Root
                id={setting.key}
                checked={checked}
                disabled={mutation.isPending}
                onCheckedChange={handleChange}
                className={styles.switchRoot}
            >
                <Switch.Thumb className={styles.switchThumb} />
            </Switch.Root>
            <span className={styles.fieldStatus}>{statusText}</span>
        </>
    );
};
