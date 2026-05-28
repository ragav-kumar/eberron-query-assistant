import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { contracts } from '@/contract/index.js';
import { SettingDto } from '@/dto/index.js';
import { mutateApi, queryApi } from '../utils.js';

const queryKey = ['api', 'settings'] as const;

/**
 * Fetches the full list of user-configurable settings. Each entry is a typed
 * SettingDto carrying metadata (label, section, constraints) and the current
 * value, so the UI can render the correct input without per-key hardcoding.
 */
export const useSettingsQuery = () => useQuery({
    queryKey,
    queryFn: () => queryApi(contracts.settings.get),
});

/**
 * Saves a single setting. On success, replaces the matching entry in the
 * cached settings list by key so the UI reflects the server-confirmed value
 * without a full refetch.
 */
export const useSettingsMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (setting: SettingDto) => mutateApi(contracts.settings.put, setting, { key: setting.key }),
        onSuccess: updated => {
            queryClient.setQueryData<SettingDto[]>(queryKey, prev =>
                prev == null
                    ? [updated]
                    : prev.map(s => s.key === updated.key ? updated : s),
            );
        },
    });
};
