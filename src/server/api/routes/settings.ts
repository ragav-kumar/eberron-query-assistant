import { SettingDto } from '@/dto/index.js';
import { settingsCatalog, settingsCatalogKeys } from '@server/db/app/settings/settingsCatalog.js';
import { settingsStore } from '@server/db/app/index.js';
import { SettingKeyName } from '@server/db/app/settings/settingKeys.js';
import { Settings } from '@server/db/app/settings/settingsStore.js';
import { readJson } from '../request.js';
import { writeErrorJson, writeJson } from '../response.js';
import { RouteDefinition } from './shared.js';

/**
 * Serializes an arbitrary settings-store value into the string|null shape
 * expected by ReadonlySettingDto. Dates become ISO strings; undefined/null
 * become null; everything else is JSON-stringified.
 */
const serializeReadonlyValue = (value: unknown): string | null => {
    if (value == null) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
};

/**
 * Builds a SettingDto for one catalog entry by reading the current value from
 * the in-memory settings store.
 *
 * Readonly entries receive a serialized string|null value rather than the raw
 * store value, matching ReadonlySettingDto's contract.
 *
 * The `as unknown as SettingDto` double-cast is required because TypeScript
 * cannot verify that spreading a union-typed catalog entry with a union-typed
 * value produces a valid discriminated-union member. The catalog guarantees
 * that each key's value type matches its settingType at runtime.
 */
const buildDto = (entry: typeof settingsCatalog[number]): SettingDto => {
    const raw = settingsStore().read(entry.key);
    const value = entry.settingType === 'readonly' ? serializeReadonlyValue(raw) : raw;
    return ({ ...entry, value }) as unknown as SettingDto;
};

export const settingsRoutes: RouteDefinition[] = [
    {
        method: 'GET',
        path: '/api/v2/settings',
        /**
         * Returns the full list of user-configurable settings with their
         * current values and type metadata.
         */
        handler: ({ response }) => {
            writeJson(response, settingsCatalog.map(buildDto));
        },
    },
    {
        method: 'PUT',
        path: '/api/v2/settings/:key',
        /**
         * Updates a single setting. Validates that the key is in the catalog,
         * rejects writes to readonly entries with 405, writes the new value to
         * the store, and logs an always-persisted console entry so the change
         * survives process restarts as an audit trail.
         */
        handler: async ({ request, response, context, pathParams }) => {
            const rawKey = pathParams['key'];

            if (rawKey == null || !settingsCatalogKeys.has(rawKey as SettingKeyName)) {
                writeErrorJson(response, 400, `Unknown or non-configurable setting: "${rawKey}".`);
                return;
            }

            const key = rawKey as SettingKeyName;
            const catalogEntry = settingsCatalog.find(e => e.key === key)!;

            if (catalogEntry.settingType === 'readonly') {
                writeErrorJson(response, 405, `Setting "${key}" is read-only and cannot be modified.`);
                return;
            }

            const body = await readJson<{ value: unknown }>(request);
            const from = settingsStore().read(key);

            // body.value carries the correct runtime type for this key (JSON.parse
            // preserves number, boolean, and array types). Cast satisfies the generic
            // write parameter without going through any.
            await settingsStore().write(context, key, body.value as Settings[typeof key]);

            const to = settingsStore().read(key);

            await context.consoleEvents.record(
                'info',
                `Setting "${key}" changed from ${JSON.stringify(from)} to ${JSON.stringify(to)}`,
            );

            writeJson(response, buildDto(catalogEntry));
        },
    },
];
