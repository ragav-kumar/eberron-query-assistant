import { describe, expect, it } from 'vitest';

describe('V2 run coordinator', () => {
    // Intentionally reset in the sanitization pass.
    // The previous suite opened real SQLite state and persisted repo-shaped runtime data.
    it('is not implemented after sanitization reset', () => {
        expect('Not implemented after sanitization reset.').toBe('Implemented');
    });
});
