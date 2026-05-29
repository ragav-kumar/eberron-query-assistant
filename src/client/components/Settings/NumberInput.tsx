import { useState } from 'react';
import { NumberSettingDto } from '@/dto/index.js';
import { joinClassNames } from '@/client/utils.js';
import { useSettingInput } from './useSettingInput.js';
import styles from './SettingsModal.module.css';

interface NumberInputProps {
    setting: NumberSettingDto;
    onSavingChange: (key: string, isSaving: boolean) => void;
    onValidationChange: (key: string, hasError: boolean) => void;
}

/**
 * Numeric input with optional min/max bounds from the DTO. Validates on every
 * keystroke and blocks save while the value is out of range or not a valid number.
 */
export const NumberInput = ({ setting, onSavingChange, onValidationChange }: NumberInputProps) => {
    const [localValue, setLocalValue] = useState(String(setting.value));
    const [confirmedValue, setConfirmedValue] = useState(setting.value);

    const numericValue = parseFloat(localValue);
    const isNaN_ = isNaN(numericValue);
    const isBelowMin = setting.min != null && numericValue < setting.min;
    const isAboveMax = setting.max != null && numericValue > setting.max;
    const hasError = isNaN_ || isBelowMin || isAboveMax;
    const errorText = isNaN_ ? 'Enter a valid number'
        : isBelowMin         ? `Minimum value is ${setting.min}`
        :                      `Maximum value is ${setting.max}`;

    const { mutation, statusText } = useSettingInput({ settingKey: setting.key, hasError, errorText, onSavingChange, onValidationChange });

    const handleBlur = () => {
        if (hasError || numericValue === confirmedValue || mutation.isPending) return;
        mutation.mutate({ ...setting, value: numericValue }, { onSuccess: () => setConfirmedValue(numericValue) });
    };

    return (
        <>
            <input
                id={setting.key}
                type='number'
                className={styles.input}
                value={localValue}
                min={setting.min}
                max={setting.max}
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
