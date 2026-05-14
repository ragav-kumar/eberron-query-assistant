import type { RuntimeConfig } from '@/types.js';

import type {
    Npc as ObjectModelNpc,
    Run as ObjectModelRun,
    RunAuditLog as ObjectModelRunAuditLog,
    Session as ObjectModelSession,
    SessionEntry as ObjectModelSessionEntry,
    Setting as ObjectModelSetting,
} from './objectModel.js';
import type {
    Npc as SchemaNpc,
    Run as SchemaRun,
    RunAuditLog as SchemaRunAuditLog,
    Session as SchemaSession,
    SessionEntry as SchemaSessionEntry,
    Setting as SchemaSetting,
} from './schema.js';

export interface RunLoadOptions {
    includeAuditLogs?: boolean;
}

export interface SessionLoadOptions {
    includeActiveRun?: boolean;
    includeRunAuditLogs?: boolean;
}

export interface V2Orm {
    bootstrap: (config: RuntimeConfig) => Promise<void>;
    close: () => void;
    npcs: {
        get: (config: RuntimeConfig, id: number) => Promise<ObjectModelNpc | null>;
        list: (config: RuntimeConfig) => Promise<ObjectModelNpc[]>;
        listByRun: (config: RuntimeConfig, runId: string) => Promise<ObjectModelNpc[]>;
        listBySession: (config: RuntimeConfig, sessionId: string) => Promise<ObjectModelNpc[]>;
        save: (config: RuntimeConfig, npc: SchemaNpc) => Promise<void>;
    };
    runAuditLogs: {
        get: (config: RuntimeConfig, id: string) => Promise<ObjectModelRunAuditLog | null>;
        listByRun: (config: RuntimeConfig, runId: string) => Promise<ObjectModelRunAuditLog[]>;
        save: (config: RuntimeConfig, auditLog: SchemaRunAuditLog) => Promise<void>;
    };
    runs: {
        get: (config: RuntimeConfig, id: string, options?: RunLoadOptions) => Promise<ObjectModelRun | null>;
        listBySession: (config: RuntimeConfig, sessionId: string) => Promise<ObjectModelRun[]>;
        save: (config: RuntimeConfig, run: SchemaRun) => Promise<void>;
    };
    sessionEntries: {
        get: (config: RuntimeConfig, sessionId: string, entryIndex: number) => Promise<ObjectModelSessionEntry | null>;
        listBySession: (config: RuntimeConfig, sessionId: string) => Promise<ObjectModelSessionEntry[]>;
        save: (config: RuntimeConfig, entry: SchemaSessionEntry) => Promise<void>;
    };
    sessions: {
        get: (config: RuntimeConfig, id: string, options?: SessionLoadOptions) => Promise<ObjectModelSession | null>;
        list: (config: RuntimeConfig) => Promise<ObjectModelSession[]>;
        save: (config: RuntimeConfig, session: SchemaSession) => Promise<void>;
    };
    settings: {
        get: (config: RuntimeConfig, key: string) => Promise<ObjectModelSetting | null>;
        list: (config: RuntimeConfig) => Promise<ObjectModelSetting[]>;
        save: (config: RuntimeConfig, setting: SchemaSetting) => Promise<void>;
    };
}
