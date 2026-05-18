/**
 * Public entrypoint for all corpus-database access.
 *
 * Callers outside this folder should import from this barrel rather than from
 * individual implementation files. That keeps the rest of the server insulated
 * from the corpus storage layout and makes it explicit that the corpus database
 * is a separate persistence boundary from the app database.
 *
 * The exported surface is intentionally small:
 * - `createCorpusStore()` for write-side corpus lifecycle and source mutations
 * - `createCorpusRetrievalService()` for retrieval reads and embedding refresh
 * - `createPartyContextService()` for campaign-context assembly from corpus rows
 * - `getCorpusDatabasePath()` and `getVectorIndexPath()` for the limited cases
 *   that truly need concrete filesystem paths
 */
export { createCorpusDatabase, getCorpusDatabasePath } from './database.js';
export { createPartyContextService } from './party-context.js';
export type { PartyContextService } from './party-context.js';
export { createCorpusRetrievalService, getVectorIndexPath } from './retrieval-service.js';
export type {
    CorpusRetrievalService,
    CorpusRetrievalServiceDependencies,
    RetrievalSyncSummary,
} from './retrieval-service.js';
export { createCorpusStore } from './store.js';
export type { CorpusStore } from './store.js';
