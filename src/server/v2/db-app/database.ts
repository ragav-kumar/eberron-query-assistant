import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import Database from 'better-sqlite3';

import type { RuntimeConfig } from '@/types.js';

const APP_DATABASE_FILENAME = 'app.sqlite';
const APP_DATABASE_ENV_KEY = 'EQA_APP_DB_PATH';

export interface AppDatabaseBootstrap {
    databasePath: string;
}

export interface AppDatabase {
    close: () => void;
    open: (bootstrap: AppDatabaseBootstrap) => Promise<Database.Database>;
}

export const getAppDatabasePath = (config: RuntimeConfig): string => path.join(config.runtimeDir, APP_DATABASE_FILENAME);

export const getDefaultAppDatabasePath = (repoRoot = process.cwd()): string => path.join(repoRoot, '.eberron-query-assistant', APP_DATABASE_FILENAME);

export const resolveAppDatabaseBootstrap = (repoRoot = process.cwd()): AppDatabaseBootstrap => {
    const envFile = parseEnvFile(path.join(repoRoot, '.env'));
    const configuredPath = readEnvValue(APP_DATABASE_ENV_KEY, envFile);

    return {
        databasePath: configuredPath == null
            ? getDefaultAppDatabasePath(repoRoot)
            : resolveConfiguredPath(repoRoot, configuredPath),
    };
};

export const createAppDatabase = (): AppDatabase => {
    let database: Database.Database | null = null;
    let databasePath: string | null = null;

    const close = (): void => {
        database?.close();
        database = null;
        databasePath = null;
    };

    const open = async (bootstrap: AppDatabaseBootstrap): Promise<Database.Database> => {
        const nextDatabasePath = bootstrap.databasePath;
        if (database && databasePath === nextDatabasePath) {
            return database;
        }

        close();
        await mkdir(path.dirname(nextDatabasePath), { recursive: true });
        database = new Database(nextDatabasePath);
        databasePath = nextDatabasePath;
        database.pragma('foreign_keys = ON');
        return database;
    };

    return {
        close,
        open,
    };
};

const readEnvValue = (key: string, envFile: Record<string, string>): string | undefined => {
    const value = process.env[key] ?? envFile[key];
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : undefined;
};

const parseEnvFile = (envPath: string): Record<string, string> => {
    if (!existsSync(envPath)) {
        return {};
    }

    const entries: Record<string, string> = {};
    const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith('#')) {
            continue;
        }

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex <= 0) {
            continue;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        const rawValue = trimmed.slice(separatorIndex + 1).trim();
        entries[key] = unwrapEnvValue(rawValue);
    }

    return entries;
};

const unwrapEnvValue = (value: string): string => {
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1);
    }

    return value;
};

const resolveConfiguredPath = (repoRoot: string, configuredPath: string): string => (
    path.isAbsolute(configuredPath)
        ? configuredPath
        : path.resolve(repoRoot, configuredPath)
);
