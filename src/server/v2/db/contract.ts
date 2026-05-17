import type {
    AdditionalContextDocument,
    ConsoleEntry,
    Npc,
    RefreshState,
    Run,
    Session,
    SessionExchange,
} from './objectModel.js';

export interface SessionLoadOptions {
    includeActiveRun?: boolean;
    includeExchanges?: boolean;
}

export interface V2Orm {
    bootstrap: () => Promise<void>;
    close: () => void;
    settings: {
        getAdditionalContext: () => Promise<AdditionalContextDocument | null>;
        saveAdditionalContext: (document: AdditionalContextDocument) => Promise<void>;
    };
    refreshState: {
        get: () => Promise<RefreshState | null>;
        save: (refreshState: RefreshState) => Promise<void>;
    };
    sessions: {
        get: (id: string, options?: SessionLoadOptions) => Promise<Session | null>;
        list: () => Promise<Session[]>;
        save: (session: Session) => Promise<void>;
    };
    sessionExchanges: {
        get: (id: string) => Promise<SessionExchange | null>;
        listBySession: (sessionId: string) => Promise<SessionExchange[]>;
        listByRun: (runId: string) => Promise<SessionExchange[]>;
        save: (exchange: SessionExchange) => Promise<void>;
    };
    runs: {
        get: (id: string) => Promise<Run | null>;
        listBySession: (sessionId: string) => Promise<Run[]>;
        save: (run: Run) => Promise<void>;
    };
    npcs: {
        get: (id: number) => Promise<Npc | null>;
        list: () => Promise<Npc[]>;
        listByRun: (runId: string) => Promise<Npc[]>;
        listBySession: (sessionId: string) => Promise<Npc[]>;
        save: (npc: Npc) => Promise<void>;
    };
    consoleEntries: {
        get: (id: string) => Promise<ConsoleEntry | null>;
        list: () => Promise<ConsoleEntry[]>;
        save: (entry: ConsoleEntry) => Promise<void>;
    };
}
