import { randomUUID } from 'node:crypto';

import { ConsoleEntryDto } from '@/dto/index.js';
import { AppDb, settingsStore } from '@server/db/app/index.js';
import { ConsoleLevel } from '@/types.js';

type ConsoleEventSubscriber = (entry: ConsoleEntryDto) => void;

export interface ConsoleEventPublisher {
    /**
     * Emits a debug-level entry. Primarily useful when `consolePersist` is
     * enabled and you want fine-grained output persisted to the DB for direct
     * inspection, without surfacing it at info/warn/error severity in normal
     * operation.
     */
    debug(message: string, timestamp?: string, template?: string): Promise<ConsoleEntryDto>;
    error(message: string, timestamp?: string, template?: string): Promise<ConsoleEntryDto>;
    info(message: string, timestamp?: string, template?: string): Promise<ConsoleEntryDto>;
    /**
     * Emits a console entry that is always persisted to the database,
     * regardless of the `consolePersist` setting.
     *
     * Use for events that must survive process restarts, such as settings
     * changes, which serve as an audit trail for accidental misconfiguration.
     */
    record(level: ConsoleLevel, message: string, timestamp?: string): Promise<ConsoleEntryDto>;
    snapshot(): Promise<ConsoleEntryDto[]>;
    subscribe(listener: ConsoleEventSubscriber): () => void;
    warn(message: string, timestamp?: string, template?: string): Promise<ConsoleEntryDto>;
}

export const createConsoleEventPublisher = (appDb: AppDb): ConsoleEventPublisher => {
    const subscribers = new Set<ConsoleEventSubscriber>();
    const shouldPersist = settingsStore().read('consolePersist');
    const inMemoryEntries: ConsoleEntryDto[] = [];

    const publish = async (
        level: ConsoleLevel,
        message: string,
        timestamp = new Date().toISOString(),
        template?: string,
    ): Promise<ConsoleEntryDto> => {
        const entry: ConsoleEntryDto = {
            id: randomUUID(),
            level,
            message,
            timestamp,
            ...(template !== undefined ? { template } : {}),
        };

        inMemoryEntries.push(entry);
        if (shouldPersist) {
            await appDb.db.insertInto('consoleEntries').values({
                createdAt: entry.timestamp,
                id: entry.id,
                level: entry.level,
                message: entry.message,
                template: entry.template ?? null,
            }).execute();
        }

        for (const subscriber of subscribers) {
            subscriber(entry);
        }

        return entry;
    };

    const persistAndPublish = async (
        level: ConsoleLevel,
        message: string,
        timestamp = new Date().toISOString(),
    ): Promise<ConsoleEntryDto> => {
        const entry: ConsoleEntryDto = { id: randomUUID(), level, message, timestamp };

        inMemoryEntries.push(entry);
        await appDb.db.insertInto('consoleEntries').values({
            createdAt: entry.timestamp,
            id: entry.id,
            level: entry.level,
            message: entry.message,
            template: null,
        }).execute();

        for (const subscriber of subscribers) {
            subscriber(entry);
        }

        return entry;
    };

    return {
        debug: (message, timestamp, template) => publish('debug', message, timestamp, template),
        error: (message, timestamp, template) => publish('error', message, timestamp, template),
        info: (message, timestamp, template) => publish('info', message, timestamp, template),
        record: (level, message, timestamp) => persistAndPublish(level, message, timestamp),
        snapshot: async () => {
            if (!shouldPersist) {
                return [...inMemoryEntries];
            }

            const entries = await appDb.db
                .selectFrom('consoleEntries')
                .selectAll()
                .orderBy('createdAt', 'asc')
                .orderBy('id', 'asc')
                .execute();

            return entries.map(entry => ({
                id: entry.id,
                level: entry.level,
                message: entry.message,
                timestamp: entry.createdAt,
                ...(entry.template !== null ? { template: entry.template } : {}),
            }));
        },
        subscribe: listener => {
            subscribers.add(listener);
            return () => {
                subscribers.delete(listener);
            };
        },
        warn: (message, timestamp, template) => publish('warn', message, timestamp, template),
    };
};
