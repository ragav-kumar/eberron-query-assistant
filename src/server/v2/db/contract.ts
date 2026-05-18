import type {
    ConsoleEntry,
    IngestedArticle,
    IngestedFile,
    Npc,
    RefreshState,
    Run,
    Session,
    SessionExchange,
    Setting,
} from './objectModel.js';

export interface SessionLoadOptions {
    includeActiveRun?: boolean;
    includeExchanges?: boolean;
}

export interface Orm {
    bootstrap: () => Promise<void>;
    close: () => void;
    ingestedFiles: {
        get: (sourceType: IngestedFile['sourceType'], filename: string) => Promise<IngestedFile | null>;
        list: () => Promise<IngestedFile[]>;
        remove: (sourceType: IngestedFile['sourceType'], filename: string) => Promise<void>;
        save: (file: IngestedFile) => Promise<void>;
    };
    ingestedArticles: {
        get: (canonicalUrl: string) => Promise<IngestedArticle | null>;
        list: () => Promise<IngestedArticle[]>;
        save: (article: IngestedArticle) => Promise<void>;
    };
    settings: {
        get: (key: string) => Promise<Setting | null>;
        list: () => Promise<Setting[]>;
        save: (setting: Setting) => Promise<void>;
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
        list: () => Promise<SessionExchange[]>;
        save: (exchange: SessionExchange) => Promise<void>;
    };
    runs: {
        get: (id: string) => Promise<Run | null>;
        list: () => Promise<Run[]>;
        save: (run: Run) => Promise<void>;
    };
    npcs: {
        get: (id: number) => Promise<Npc | null>;
        list: () => Promise<Npc[]>;
        save: (npc: Npc) => Promise<void>;
    };
    consoleEntries: {
        get: (id: string) => Promise<ConsoleEntry | null>;
        list: () => Promise<ConsoleEntry[]>;
        save: (entry: ConsoleEntry) => Promise<void>;
    };
}
