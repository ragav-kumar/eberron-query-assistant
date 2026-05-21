import { describe, expect, it } from 'vitest';

describe('v2 corpus boundary', () => {
    // Intentionally reset in the sanitization pass.
    // The previous suite opened real SQLite-backed corpus stores and host temp directories.
    it('is not implemented after sanitization reset', () => {
        expect('Not implemented after sanitization reset.').toBe('Implemented');
    });
});
