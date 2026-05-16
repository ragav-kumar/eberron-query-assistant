import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ConsoleEntry, NpcCollection, Refresh, Run, Session, AssistantEntry, SessionSummary } from '@/dto/index.js';

const ADDITIONAL_CONTEXT_MARKDOWN = `# Campaign Context

Use this context as local campaign guidance. It is not retrieved evidence, so do not cite it as a source. When it conflicts with retrieved session notes, prefer the session notes for what has actually happened in play.

## Canon And Source Weighting

* The campaign setting is Eberron. Adventures or modules written for other campaign settings should be interpreted as adapted into Eberron.

## Player-Facing Guidance

* Peanunt's player enjoys drama, aura farming, and roleplay. Peanunt is being played as deliberately edgy. He's also played as counter cultural vis-a-vis the Sovereign Host and the Dark Six, while being a fundamentally good person who wants to help people.
* Spark's player is leaning into the creator/inventor role and the warforged-as-POC-stand-in theme. He plays Spark as a bit awkward and introverted. His primary narrative thread appears to be his Haunted by the Mourning secret.
* Durotan's player tends to focus on the immediate scene and combat. Keep lore concise and concrete, without too much player-facing complexity, when Durotan is the focus. Complex information that the GM has to track is okay.
`;

const SESSION_SUMMARIES: SessionSummary[] = [
    {
        id: 'session-dragonshards',
        mode: 'assistant',
        title: 'Dragonshard pricing tiers',
        createdAt: '2026-05-09T08:45:59.000Z',
        updatedAt: '2026-05-09T08:45:59.000Z',
        activeRunId: null,
        includePartyContext: true,
        lastEntryPreview: 'Summarize this conversation into a reference document.',
    },
    {
        id: 'session-dal-quor',
        mode: 'assistant',
        title: 'Dal Quor vault pitch',
        createdAt: '2026-05-07T21:10:42.000Z',
        updatedAt: '2026-05-07T21:10:42.000Z',
        activeRunId: 'run-dal-quor-1',
        includePartyContext: true,
        lastEntryPreview: "Let's give it a professional, spies / heist vibe.",
    },
    {
        id: 'session-thornwood',
        mode: 'assistant',
        title: 'Thornwood north of Vathirond',
        createdAt: '2026-05-09T09:10:07.000Z',
        updatedAt: '2026-05-09T09:10:07.000Z',
        activeRunId: null,
        includePartyContext: true,
        lastEntryPreview: 'Is there anything in the lore about the Thornwood (north of Vathirond)?',
    },
];

const SESSIONS = new Map<string, Session>([
    ['session-dragonshards', {
        id: 'session-dragonshards',
        mode: 'assistant',
        title: 'Dragonshard pricing tiers',
        createdAt: '2026-05-09T08:45:59.000Z',
        updatedAt: '2026-05-09T08:45:59.000Z',
        activeRunId: null,
        includePartyContext: true,
        promotedFromSessionId: null,
        promotedToSessionId: null,
    }],
    ['session-dal-quor', {
        id: 'session-dal-quor',
        mode: 'assistant',
        title: 'Dal Quor vault pitch',
        createdAt: '2026-05-07T21:10:42.000Z',
        updatedAt: '2026-05-07T21:10:42.000Z',
        activeRunId: 'run-dal-quor-1',
        includePartyContext: true,
        promotedFromSessionId: null,
        promotedToSessionId: null,
    }],
    ['session-thornwood', {
        id: 'session-thornwood',
        mode: 'assistant',
        title: 'Thornwood north of Vathirond',
        createdAt: '2026-05-09T09:10:07.000Z',
        updatedAt: '2026-05-09T09:10:07.000Z',
        activeRunId: null,
        includePartyContext: true,
        promotedFromSessionId: null,
        promotedToSessionId: null,
    }],
]);

const SESSION_ENTRIES = new Map<string, { sessionId: string; exchanges: { id: string; sessionId: string; createdAt: string; updatedAt: string; runId: string; status: Run['status']; entries: AssistantEntry[]; }[] }>([
    ['session-dal-quor', {
        sessionId: 'session-dal-quor',
        exchanges: [{
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
                    content: 'Mock session timeline for v2 UI build-out based on a real session log.',
                    toolCallId: null,
                },
                {
                    id: 'session-dal-quor-reasoning-2',
                    kind: 'reasoning',
                    sessionId: 'session-dal-quor',
                    runId: 'run-dal-quor-1',
                    exchangeId: 'exchange-dal-quor-1',
                    createdAt: '2026-05-07T21:10:43.000Z',
                    content: 'Looking for Eberron dragonshard tier and pricing guidance.',
                    toolCallId: null,
                },
                {
                    id: 'session-dal-quor-response-1',
                    kind: 'response',
                    sessionId: 'session-dal-quor',
                    runId: 'run-dal-quor-1',
                    exchangeId: 'exchange-dal-quor-1',
                    createdAt: '2026-05-07T21:10:44.000Z',
                    title: 'Golden Vault spiel for the forest temple',
                    content: "I can do that, but I need one or two details first so I don’t invent the wrong Golden Vault hook.\n\nWhat I have from the notes:\n- The active Vathirond thread includes **“Golden Vault”** and a dead drop at the memorial to the fallen, with a planned spiel for **“Reach for the Stars”**.\n- You want to adapt that into a **Forest Temple in Dal Quor** with a 4-day access window, poe sisters, a phantom Ganon adaptation, and a vault objective at the end.\n\nTo write a good alternate spiel, I need to know what the Golden Vault wants recovered, who the intended contact is, how obvious the job should sound to the players, and whether the time limit should be explicit in the briefing.",
                },
                {
                    id: 'session-dal-quor-user-1',
                    kind: 'user',
                    sessionId: 'session-dal-quor',
                    runId: 'run-dal-quor-1',
                    exchangeId: 'exchange-dal-quor-1',
                    createdAt: '2026-05-07T21:10:45.000Z',
                    content: "I'm planning to blend Durotan's dream and the golden vault plot thread with each other. Specifically, I'm thinking of replacing most of Reach for the stars with an adaptation of the Legend of Zelda Ocarina of Time dungeon, The Forest Temple.",
                },
                {
                    id: 'session-dal-quor-response-2',
                    kind: 'response',
                    sessionId: 'session-dal-quor',
                    runId: 'run-dal-quor-1',
                    exchangeId: 'exchange-dal-quor-1',
                    createdAt: '2026-05-07T21:10:46.000Z',
                    title: 'Golden Vault spiel options',
                    content: "Got it. Since you want this to feel like an early capital-G Good Golden Vault job, with a clear fetch object, prep encouraged, and no overt Dal Quor hint, here are three spiel options you can use or remix.\n\nOption 1 is a straightforward recovery mission from an old forest reliquary. Option 2 positions the object as a missing star map hidden in a warded shrine. Option 3 frames the job as recovering an item from a place where someone trapped inside also needs help.\n\nMy recommendation was Option 3 for the strongest moral hook, or Option 2 if you want the closest structural match to Reach for the Stars.",
                },
                {
                    id: 'session-dal-quor-user-2',
                    kind: 'user',
                    sessionId: 'session-dal-quor',
                    runId: 'run-dal-quor-1',
                    exchangeId: 'exchange-dal-quor-1',
                    createdAt: '2026-05-07T21:10:47.000Z',
                    content: "Let's give it a professional, spies / heist vibe. Almost Q from james bond like, but you know, less familiar, since this is the first actual golden vault interaction. Do all the variants you've suggested, I'll pick / combine them myself later.",
                },
                {
                    id: 'session-dal-quor-response-3',
                    kind: 'response',
                    sessionId: 'session-dal-quor',
                    runId: 'run-dal-quor-1',
                    exchangeId: 'exchange-dal-quor-1',
                    createdAt: '2026-05-07T21:10:48.000Z',
                    title: 'Golden Vault briefing variants',
                    content: "Absolutely. If you want first-contact Golden Vault to feel more like a professional intelligence or heist briefing than a quest-giver monologue, here are three polished variants in that style.\n\nVariant 1 keeps a clean field-op tone and emphasizes competence. Variant 2 leans harder into spy or extraction energy. Variant 3 is more mysterious while still sounding professional.\n\nFor your Forest Temple and Dal Quor blend, Variant 1 is the cleanest Good-aligned fit, Variant 2 is the strongest heist tone, and Variant 3 gives you the most mystery and flexibility.",
                },
            ],
        }],
    }],
]);

const RUNS = new Map<string, Run>([
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

const NPCS: NpcCollection = {
    activeFilter: '',
    npcs: [
        {
            id: 4,
            sessionId: 'session-dal-quor',
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
            sessionId: 'session-dal-quor',
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
            sessionId: 'session-dal-quor',
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
            sessionId: 'session-dal-quor',
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

const REFRESH: Refresh = {
    activeOperation: null,
    lastRefreshAt: '2026-05-08T17:49:08.127Z',
    lastReingestAt: null,
    refreshStatus: 'completed',
    reingestStatus: 'idle',
    createdAt: '2026-05-08T17:49:05.654Z',
    updatedAt: '2026-05-08T17:49:08.127Z',
};

const CONSOLE_ENTRIES: ConsoleEntry[] = [
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

const DEFAULT_CREATED_SESSION: Session = {
    id: 'session-dal-quor',
    mode: 'assistant',
    title: 'Dal Quor vault pitch',
    createdAt: '2026-05-07T21:10:42.000Z',
    updatedAt: '2026-05-07T21:10:42.000Z',
    activeRunId: 'run-dal-quor-1',
    includePartyContext: true,
    promotedFromSessionId: null,
    promotedToSessionId: null,
};

const DEFAULT_CREATED_RUN: Run = {
    id: 'run-dal-quor-1',
    sessionId: 'session-dal-quor',
    mode: 'assistant',
    status: 'completed',
    createdAt: '2026-05-07T21:10:42.000Z',
    updatedAt: '2026-05-07T21:10:48.000Z',
    exchangeId: 'exchange-dal-quor-1',
};

export const handleV2ApiRequest = (
    request: IncomingMessage,
    response: ServerResponse,
): void => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (request.method === 'GET' && url.pathname === '/api/v2/additional-context') {
        // Mock response for v2 UI build-out; no persistence yet.
        writeText(response, 200, ADDITIONAL_CONTEXT_MARKDOWN, 'text/markdown; charset=utf-8');
        return;
    }

    if (request.method === 'PUT' && url.pathname === '/api/v2/additional-context') {
        // Mock response for v2 UI build-out; no persistence yet.
        writeText(response, 200, ADDITIONAL_CONTEXT_MARKDOWN, 'text/plain; charset=utf-8');
        return;
    }

    if (request.method === 'GET' && url.pathname === '/api/v2/sessions') {
        // Mock response for v2 UI build-out; no persistence yet.
        writeJson(response, 200, SESSION_SUMMARIES);
        return;
    }

    if (request.method === 'POST' && url.pathname === '/api/v2/sessions') {
        // Mock response for v2 UI build-out; no persistence yet.
        writeJson(response, 200, DEFAULT_CREATED_SESSION);
        return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/v2/sessions/')) {
        const sessionPath = url.pathname.slice('/api/v2/sessions/'.length);

        if (sessionPath.endsWith('/entries')) {
            const sessionId = sessionPath.slice(0, -'/entries'.length);
            const entries = SESSION_ENTRIES.get(sessionId);
            if (entries) {
                // Mock response for v2 UI build-out; no persistence yet.
                writeJson(response, 200, entries);
                return;
            }
        } else {
            const session = SESSIONS.get(sessionPath);
            if (session) {
                // Mock response for v2 UI build-out; no persistence yet.
                writeJson(response, 200, session);
                return;
            }
        }
    }

    if (request.method === 'POST' && url.pathname.startsWith('/api/v2/sessions/') && url.pathname.endsWith('/runs')) {
        const sessionId = url.pathname.slice('/api/v2/sessions/'.length, -'/runs'.length);
        if (SESSIONS.has(sessionId)) {
            // Mock response for v2 UI build-out; no persistence yet.
            writeJson(response, 200, {
                ...DEFAULT_CREATED_RUN,
                sessionId,
            } satisfies Run);
            return;
        }
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/v2/runs/')) {
        const runId = url.pathname.slice('/api/v2/runs/'.length);
        const run = RUNS.get(runId);
        if (run) {
            // Mock response for v2 UI build-out; no persistence yet.
            writeJson(response, 200, run);
            return;
        }
    }

    if (request.method === 'GET' && url.pathname === '/api/v2/npcs') {
        // Mock response for v2 UI build-out; no persistence yet.
        writeJson(response, 200, NPCS);
        return;
    }

    if (request.method === 'GET' && url.pathname === '/api/v2/refresh') {
        // Mock response for v2 UI build-out; no persistence yet.
        writeJson(response, 200, REFRESH);
        return;
    }

    if (request.method === 'POST' && url.pathname === '/api/v2/refresh') {
        // Mock response for v2 UI build-out; no persistence yet.
        writeJson(response, 200, REFRESH);
        return;
    }

    if (request.method === 'GET' && url.pathname === '/api/v2/console') {
        // Mock response for v2 UI build-out; no persistence yet.
        writeJson(response, 200, CONSOLE_ENTRIES);
        return;
    }

    if (request.method === 'GET' && url.pathname === '/api/v2/console/events') {
        // Mock SSE endpoint for v2 UI build-out; intentionally emits no events yet.
        writeSse(response, request);
        return;
    }

    if (request.method === 'GET' && url.pathname === '/api/v2/runtime/events') {
        // Mock SSE endpoint for v2 UI build-out; intentionally emits no events yet.
        writeSse(response, request);
        return;
    }

    writeJson(response, 404, {error: 'Unknown API route.'});
};

const writeJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(body));
};

const writeText = (response: ServerResponse, statusCode: number, body: string, contentType: string): void => {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', contentType);
    response.end(body);
};

const writeSse = (response: ServerResponse, request: IncomingMessage): void => {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders?.();
    response.write?.(': connected\n\n');
    request.on('close', () => {
        response.end();
    });
};
