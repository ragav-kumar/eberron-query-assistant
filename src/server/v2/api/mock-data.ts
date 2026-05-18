import type { ConsoleEntry, NpcCollection, Refresh, Run, Session, SessionFeed } from '@/dto/index.js';

export const ADDITIONAL_CONTEXT_MARKDOWN = `# Campaign Context

Use this context as local campaign guidance. It is not retrieved evidence, so do not cite it as a source. When it conflicts with retrieved session notes, prefer the session notes for what has actually happened in play.

## Canon And Source Weighting

* The campaign setting is Eberron. Adventures or modules written for other campaign settings should be interpreted as adapted into Eberron.

## Player-Facing Guidance

* Peanunt's player enjoys drama, aura farming, and roleplay. Peanunt is being played as deliberately edgy. He's also played as counter cultural vis-a-vis the Sovereign Host and the Dark Six, while being a fundamentally good person who wants to help people.
* Spark's player is leaning into the creator/inventor role and the warforged-as-POC-stand-in theme. He plays Spark as a bit awkward and introverted. His primary narrative thread appears to be his Haunted by the Mourning secret.
* Durotan's player tends to focus on the immediate scene and combat. Keep lore concise and concrete, without too much player-facing complexity, when Durotan is the focus. Complex information that the GM has to track is okay.
`;

export const SESSIONS: Session[] = [
    {
        id: 'session-dragonshards',
        mode: 'assistant',
        title: 'Dragonshard pricing tiers',
        exchangeCount: 0,
        createdAt: '2026-05-09T08:45:59.000Z',
        updatedAt: '2026-05-09T08:45:59.000Z',
        activeRunId: null,
        includePartyContext: true,
    },
    {
        id: 'session-dal-quor',
        mode: 'assistant',
        title: 'Dal Quor vault pitch',
        exchangeCount: 1,
        createdAt: '2026-05-07T21:10:42.000Z',
        updatedAt: '2026-05-07T21:10:48.000Z',
        activeRunId: 'run-dal-quor-1',
        includePartyContext: true,
    },
    {
        id: 'session-thornwood',
        mode: 'assistant',
        title: 'Thornwood north of Vathirond',
        exchangeCount: 0,
        createdAt: '2026-05-09T09:10:07.000Z',
        updatedAt: '2026-05-09T09:10:07.000Z',
        activeRunId: null,
        includePartyContext: true,
    },
    {
        id: 'session-boxing-contenders',
        mode: 'npc',
        title: 'Boxing contenders',
        exchangeCount: 0,
        createdAt: '2026-05-10T02:23:14.845Z',
        updatedAt: '2026-05-10T02:23:14.845Z',
        activeRunId: null,
        includePartyContext: true,
    },
];

export const SESSION_FEEDS = new Map<string, SessionFeed>([
    ['session-dragonshards', {
        sessionId: 'session-dragonshards',
        mode: 'assistant',
        items: [],
    }],
    ['session-dal-quor', {
        sessionId: 'session-dal-quor',
        mode: 'assistant',
        items: [{
            id: 'exchange-dal-quor-1',
            sessionId: 'session-dal-quor',
            createdAt: '2026-05-07T21:10:42.000Z',
            updatedAt: '2026-05-07T21:10:48.000Z',
            runId: 'run-dal-quor-1',
            status: 'completed',
            entries: [
                {
                    id: 'session-dal-quor-reasoning-1',
                    kind: 'reasoning',
                    sessionId: 'session-dal-quor',
                    runId: 'run-dal-quor-1',
                    exchangeId: 'exchange-dal-quor-1',
                    createdAt: '2026-05-07T21:10:42.000Z',
                    content: 'Looking for Eberron dragonshard tier and pricing guidance.',
                    toolCallId: null,
                },
                {
                    id: 'session-dal-quor-user-1',
                    kind: 'user',
                    sessionId: 'session-dal-quor',
                    runId: 'run-dal-quor-1',
                    exchangeId: 'exchange-dal-quor-1',
                    createdAt: '2026-05-07T21:10:45.000Z',
                    content: "Let's give it a professional, spies / heist vibe.",
                },
                {
                    id: 'session-dal-quor-response-1',
                    kind: 'response',
                    sessionId: 'session-dal-quor',
                    runId: 'run-dal-quor-1',
                    exchangeId: 'exchange-dal-quor-1',
                    createdAt: '2026-05-07T21:10:48.000Z',
                    title: 'Golden Vault briefing variants',
                    content: 'Variant 1 keeps a clean field-op tone and emphasizes competence. Variant 2 leans harder into spy or extraction energy. Variant 3 is more mysterious while still sounding professional.',
                },
            ],
        }],
    }],
    ['session-thornwood', {
        sessionId: 'session-thornwood',
        mode: 'assistant',
        items: [],
    }],
    ['session-boxing-contenders', {
        sessionId: 'session-boxing-contenders',
        mode: 'npc',
        items: [],
    }],
]);

export const RUNS = new Map<string, Run>([
    ['run-dal-quor-1', {
        id: 'run-dal-quor-1',
        sessionId: 'session-dal-quor',
        mode: 'assistant',
        status: 'completed',
        createdAt: '2026-05-07T21:10:42.000Z',
        updatedAt: '2026-05-07T21:10:48.000Z',
        exchangeId: 'exchange-dal-quor-1',
    }],
]);

export const DEFAULT_CREATED_RUN: Run = {
    id: 'run-dal-quor-1',
    sessionId: 'session-dal-quor',
    mode: 'assistant',
    status: 'completed',
    createdAt: '2026-05-07T21:10:42.000Z',
    updatedAt: '2026-05-07T21:10:48.000Z',
    exchangeId: 'exchange-dal-quor-1',
};

export const NPCS: NpcCollection = {
    filter: '',
    npcs: [
        {
            id: 4,
            sessionId: 'session-boxing-contenders',
            name: 'Mara d’Thuranni',
            species: 'Elf (Khoravar)',
            ethnicity: 'House Thuranni (Phiarlan-descended)',
            gender: 'Woman',
            role: 'Boxing tournament contender; blade-for-hire moonlighting as a prizefighter',
            age: 'late 20s',
            description: 'Lean, long-limbed elf with close-cropped silver hair, bruised knuckles, and a neat black wraps-and-vest ring outfit.',
            bio: 'Keeps her guard high and her mouth shut; fights for coin and to scout talent in rough places.',
            createdAt: '2026-05-03T21:03:21.588Z',
            updatedAt: '2026-05-03T21:04:36.555Z',
        },
        {
            id: 8,
            sessionId: 'session-boxing-contenders',
            name: "K-14 'Kestrel'",
            species: 'Warforged',
            ethnicity: 'Cannith-built (Last War veteran)',
            gender: 'Masculine-presenting',
            role: 'Boxing tournament contender; veteran pit-fighter seeking legitimacy',
            age: 'about 6 years since the Treaty of Thronehold',
            description: 'Compact warforged with mottled bronze plating, neatly stenciled unit marks, and reinforced knuckle-plates polished smooth by constant impact.',
            bio: 'Fights with drilled restraint and sudden explosive bursts; endures crowd hostility with silent focus.',
            createdAt: '2026-05-03T21:04:36.555Z',
            updatedAt: '2026-05-03T21:04:36.555Z',
        },
        {
            id: 9,
            sessionId: 'session-boxing-contenders',
            name: 'Thrum, Keeper of the Blue Room',
            species: 'Warforged',
            ethnicity: 'Reforged',
            gender: 'She/her',
            role: 'Reforged facilitator, emotional archivist, informal counselor',
            age: 'about 27 years old (chosen 997 YK)',
            description: 'Tall, slim warforged with sanded-down plating, repainted seams, polished darkwood panels, a deep blue scarf, and a small bell tied to one wrist.',
            bio: 'Helps other warforged explore feeling, memory, and self-realization; believes living means learning how to live.',
            createdAt: '2026-05-10T00:18:10.644Z',
            updatedAt: '2026-05-10T00:18:10.644Z',
        },
        {
            id: 15,
            sessionId: 'session-boxing-contenders',
            name: "Tink 'Blue Spark'",
            species: 'Warforged',
            ethnicity: 'Cannith-built',
            gender: 'They/them',
            role: 'Prizefighting contender',
            age: 'about 7 years since the Treaty of Thronehold',
            description: 'Compact warforged with cobalt enamel accents, reinforced forearms, and faint scorch marks around the shoulders.',
            bio: 'A disciplined mechanical fighter whose style is clean, efficient, and unexpectedly graceful.',
            createdAt: '2026-05-10T02:23:14.845Z',
            updatedAt: '2026-05-10T02:23:14.845Z',
        },
    ],
    skip: 0,
    take: 4,
    totalCount: 4,
};

export const REFRESH: Refresh = {
    activeOperation: null,
    lastRefreshAt: '2026-05-08T17:49:08.127Z',
    lastReingestAt: null,
    refreshStatus: 'completed',
    reingestStatus: 'idle',
    createdAt: '2026-05-08T17:49:05.654Z',
    updatedAt: '2026-05-08T17:49:08.127Z',
};

export const CONSOLE_ENTRIES: ConsoleEntry[] = [
    {
        id: 'console-1',
        level: 'info',
        message: 'foundry: delta export files already applied; skipping foundry refresh. discovered=1, added=0, updated=0, removed=0, failed=0, status=skipped.',
        timestamp: '2026-05-08T17:49:05.654Z',
    },
    {
        id: 'console-2',
        level: 'info',
        message: 'pdf: 13 PDF file(s) unchanged; skipping PDF refresh. discovered=13, added=0, updated=0, removed=0, failed=0, status=skipped.',
        timestamp: '2026-05-08T17:49:05.654Z',
    },
    {
        id: 'console-3',
        level: 'info',
        message: 'article: recent Keith Baker index scrape recorded; skipping article discovery. discovered=348, added=0, updated=0, removed=0, failed=0, status=skipped.',
        timestamp: '2026-05-08T17:49:05.654Z',
    },
    {
        id: 'console-4',
        level: 'info',
        message: 'Ingestion refresh complete.',
        timestamp: '2026-05-08T17:49:08.126Z',
    },
    {
        id: 'console-5',
        level: 'info',
        message: 'Startup refresh complete.',
        timestamp: '2026-05-08T17:49:08.127Z',
    },
];
