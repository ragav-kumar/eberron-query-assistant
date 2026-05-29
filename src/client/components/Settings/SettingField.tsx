import { SettingDto } from '@/dto/index.js';
import { StringInput } from './StringInput.js';
import { PasswordInput } from './PasswordInput.js';
import { NumberInput } from './NumberInput.js';
import { BooleanInput } from './BooleanInput.js';
import { TextareaInput } from './TextareaInput.js';
import { ArrayInput } from './ArrayInput.js';
import { UrlInput } from './UrlInput.js';
import { PathInput } from './PathInput.js';
import styles from './SettingsModal.module.css';

interface SettingFieldProps {
    setting: SettingDto;
    onSavingChange: (key: string, isSaving: boolean) => void;
    onValidationChange: (key: string, hasError: boolean) => void;
}

/**
 * Renders the label, description, and the appropriate input component for a
 * single setting. Switches on `settingType` so all type-specific rendering is
 * confined here; the modal body is otherwise generic.
 *
 * Readonly settings show a static value and never trigger mutations.
 */
export const SettingField = ({ setting, onSavingChange, onValidationChange }: SettingFieldProps) => (
    <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={setting.key}>
            {setting.label}
        </label>
        {setting.description && (
            <p className={styles.fieldDescription}>{setting.description}</p>
        )}
        {renderInput(setting, onSavingChange, onValidationChange)}
    </div>
);

const renderInput = (
    setting: SettingDto,
    onSavingChange: (key: string, isSaving: boolean) => void,
    onValidationChange: (key: string, hasError: boolean) => void,
) => {
    switch (setting.settingType) {
        case 'string':
            return <StringInput setting={setting} onSavingChange={onSavingChange} onValidationChange={onValidationChange} />;
        case 'password':
            return <PasswordInput setting={setting} onSavingChange={onSavingChange} onValidationChange={onValidationChange} />;
        case 'number':
            return <NumberInput setting={setting} onSavingChange={onSavingChange} onValidationChange={onValidationChange} />;
        case 'boolean':
            return <BooleanInput setting={setting} onSavingChange={onSavingChange} onValidationChange={onValidationChange} />;
        case 'textarea':
            return <TextareaInput setting={setting} onSavingChange={onSavingChange} onValidationChange={onValidationChange} />;
        case 'array':
            return <ArrayInput setting={setting} onSavingChange={onSavingChange} onValidationChange={onValidationChange} />;
        case 'url':
            return <UrlInput setting={setting} onSavingChange={onSavingChange} onValidationChange={onValidationChange} />;
        case 'path':
            return <PathInput setting={setting} onSavingChange={onSavingChange} onValidationChange={onValidationChange} />;
        case 'readonly':
            return <p id={setting.key} className={styles.readonlyValue}>{setting.value ?? 'Not set'}</p>;
    }
};
