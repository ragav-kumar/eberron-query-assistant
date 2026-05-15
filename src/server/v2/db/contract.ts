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
    bootstrap: () => Promise<void>;
    close: () => void;
    npcs: {
        get: (id: number) => Promise<Npc | null>;
        list: () => Promise<Npc[]>;
        listByRun: (runId: string) => Promise<Npc[]>;
        listBySession: (sessionId: string) => Promise<Npc[]>;
        save: (npc: Npc) => Promise<void>;
    };
    runAuditLogs: {
        get: (id: string) => Promise<RunAuditLog | null>;
        listByRun: (runId: string) => Promise<RunAuditLog[]>;
        save: (auditLog: RunAuditLog) => Promise<void>;
    };
    runs: {
        get: (id: string, options?: RunLoadOptions) => Promise<Run | null>;
        listBySession: (sessionId: string) => Promise<Run[]>;
        save: (run: Run) => Promise<void>;
    };
    sessionEntries: {
        get: (sessionId: string, entryIndex: number) => Promise<SessionEntry | null>;
        listBySession: (sessionId: string) => Promise<SessionEntry[]>;
        save: (entry: SessionEntry) => Promise<void>;
    };
    sessions: {
        get: (id: string, options?: SessionLoadOptions) => Promise<Session | null>;
        list: () => Promise<Session[]>;
        save: (session: Session) => Promise<void>;
    };
    settings: {
        get: (key: string) => Promise<Setting | null>;
        list: () => Promise<Setting[]>;
        save: (setting: Setting) => Promise<void>;
    };
}
