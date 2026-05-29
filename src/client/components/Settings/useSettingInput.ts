import { useEffect } from 'react';
import { useSettingsMutation } from '@/client/api/index.js';

interface UseSettingInputOptions {
    settingKey: string;
    /** Whether the current value fails validation. Defaults to false. */
    hasError?: boolean;
    /** Status text shown when `hasError` is true. */
    errorText?: string;
    onSavingChange: (key: string, isSaving: boolean) => void;
    onValidationChange: (key: string, hasError: boolean) => void;
}

/**
 * Cross-cutting hook for all setting input components. Owns the mutation
 * instance, registers the field's saving/error state with the parent
 * SettingsModal (so it can block dismissal), and returns a status string for
 * the save indicator.
 *
 * Non-validating inputs omit `hasError` and `errorText`; validating inputs
 * supply both so the hook can surface the constraint message instead of the
 * generic save state.
 */
export const useSettingInput = ({
    settingKey,
    hasError = false,
    errorText = '',
    onSavingChange,
    onValidationChange,
}: UseSettingInputOptions) => {
    const mutation = useSettingsMutation();

    useEffect(() => {
        onSavingChange(settingKey, mutation.isPending);
        return () => onSavingChange(settingKey, false);
    }, [mutation.isPending, settingKey, onSavingChange]);

    useEffect(() => {
        onValidationChange(settingKey, hasError);
        return () => onValidationChange(settingKey, false);
    }, [hasError, settingKey, onValidationChange]);

    const statusText = hasError
        ? errorText
        : mutation.isPending  ? 'Saving…'
        : mutation.isError    ? 'Failed to save'
        : mutation.isSuccess  ? 'Saved'
        : '';

    return { mutation, statusText };
};
