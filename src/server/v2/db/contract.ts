import type { RuntimeConfig } from '@/types.js';

import type {
    Npc,
    Run,
    RunAuditLog,
    Session,
    SessionEntry,
    Setting,
} from './objectModel.js';

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
        get: (config: RuntimeConfig, id: number) => Promise<Npc | null>;
        list: (config: RuntimeConfig) => Promise<Npc[]>;
        listByRun: (config: RuntimeConfig, runId: string) => Promise<Npc[]>;
        listBySession: (config: RuntimeConfig, sessionId: string) => Promise<Npc[]>;
        save: (config: RuntimeConfig, npc: Npc) => Promise<void>;
    };
    runAuditLogs: {
        get: (config: RuntimeConfig, id: string) => Promise<RunAuditLog | null>;
        listByRun: (config: RuntimeConfig, runId: string) => Promise<RunAuditLog[]>;
        save: (config: RuntimeConfig, auditLog: RunAuditLog) => Promise<void>;
    };
    runs: {
        get: (config: RuntimeConfig, id: string, options?: RunLoadOptions) => Promise<Run | null>;
        listBySession: (config: RuntimeConfig, sessionId: string) => Promise<Run[]>;
        save: (config: RuntimeConfig, run: Run) => Promise<void>;
    };
    sessionEntries: {
        get: (config: RuntimeConfig, sessionId: string, entryIndex: number) => Promise<SessionEntry | null>;
        listBySession: (config: RuntimeConfig, sessionId: string) => Promise<SessionEntry[]>;
        save: (config: RuntimeConfig, entry: SessionEntry) => Promise<void>;
    };
    sessions: {
        get: (config: RuntimeConfig, id: string, options?: SessionLoadOptions) => Promise<Session | null>;
        list: (config: RuntimeConfig) => Promise<Session[]>;
        save: (config: RuntimeConfig, session: Session) => Promise<void>;
    };
    settings: {
        get: (config: RuntimeConfig, key: string) => Promise<Setting | null>;
        list: (config: RuntimeConfig) => Promise<Setting[]>;
        save: (config: RuntimeConfig, setting: Setting) => Promise<void>;
    };
}
