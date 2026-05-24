import { randomUUID } from 'node:crypto';

import { ConsoleEntryDto } from '@/dto/index.js';
import { AppDb, settingsStore } from '@server/db/app/index.js';
import { ConsoleLevel } from '@/types.js';

type ConsoleEventSubscriber = (entry: ConsoleEntryDto) => void;

export interface ConsoleEventPublisher {
    debug(message: string, timestamp?: string): Promise<ConsoleEntryDto>;
    error(message: string, timestamp?: string): Promise<ConsoleEntryDto>;
    info(message: string, timestamp?: string): Promise<ConsoleEntryDto>;
    snapshot(): Promise<ConsoleEntryDto[]>;
    subscribe(listener: ConsoleEventSubscriber): () => void;
    warn(message: string, timestamp?: string): Promise<ConsoleEntryDto>;
}

export const createConsoleEventPublisher = (appDb: AppDb): Promise<ConsoleEventPublisher> => {
    const subscribers = new Set<ConsoleEventSubscriber>();
    const shouldPersist = settingsStore().read('providerDebug');
    const inMemoryEntries: ConsoleEntryDto[] = [];

    const publish = async (
        level: ConsoleLevel,
        message: string,
        timestamp = new Date().toISOString(),
    ): Promise<ConsoleEntryDto> => {
        const entry: ConsoleEntryDto = {
            id: randomUUID(),
            level,
            message,
            timestamp,
        };

        inMemoryEntries.push(entry);
        if (shouldPersist) {
            await appDb.db.insertInto('consoleEntries').values({
                createdAt: entry.timestamp,
                id: entry.id,
                level: entry.level,
                message: entry.message,
            }).execute();
        }

        for (const subscriber of subscribers) {
            subscriber(entry);
        }

        return entry;
    };

    return Promise.resolve({
        debug: (message, timestamp) => publish('debug', message, timestamp),
        error: (message, timestamp) => publish('error', message, timestamp),
        info: (message, timestamp) => publish('info', message, timestamp),
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
            }));
        },
        subscribe: listener => {
            subscribers.add(listener);
            return () => {
                subscribers.delete(listener);
            };
        },
        warn: (message, timestamp) => publish('warn', message, timestamp),
    });
};
