import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { PasswordSettingDto } from '@/dto/index.js';
import { joinClassNames } from '@/client/utils.js';
import { useSettingInput } from './useSettingInput.js';
import styles from './SettingsModal.module.css';

interface PasswordInputProps {
    setting: PasswordSettingDto;
    onSavingChange: (key: string, isSaving: boolean) => void;
    onValidationChange: (key: string, hasError: boolean) => void;
}

/** Masked text input for a password or secret setting. Includes a show/hide toggle. Saves on blur when the value has changed from the last confirmed state. */
export const PasswordInput = ({ setting, onSavingChange, onValidationChange }: PasswordInputProps) => {
    const [localValue, setLocalValue] = useState(setting.value);
    const [confirmedValue, setConfirmedValue] = useState(setting.value);
    const [showPassword, setShowPassword] = useState(false);
    const { mutation, statusText } = useSettingInput({ settingKey: setting.key, onSavingChange, onValidationChange });

    const handleBlur = () => {
        if (localValue === confirmedValue || mutation.isPending) return;
        mutation.mutate({ ...setting, value: localValue }, { onSuccess: () => setConfirmedValue(localValue) });
    };

    return (
        <>
            <div className={styles.passwordWrap}>
                <input
                    id={setting.key}
                    type={showPassword ? 'text' : 'password'}
                    className={joinClassNames(styles.input, styles.passwordInput)}
                    value={localValue}
                    onChange={e => setLocalValue(e.target.value)}
                    onBlur={handleBlur}
                    autoComplete='off'
                />
                <button
                    type='button'
                    className={styles.passwordToggle}
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
            </div>
            <span className={styles.fieldStatus}>{statusText}</span>
        </>
    );
};
