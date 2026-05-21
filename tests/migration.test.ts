import { describe, expect, it } from 'vitest';

describe('migrateV1DiskToV2Db', () => {
    // Intentionally reset in the sanitization pass.
    // The previous suite created temp runtime trees and opened app SQLite state to migrate them.
    it('is not implemented after sanitization reset', () => {
        expect('Not implemented after sanitization reset.').toBe('Implemented');
    });
});
