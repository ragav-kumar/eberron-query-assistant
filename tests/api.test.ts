import { describe, expect, it } from 'vitest';

describe('V2 API router', () => {
    // Intentionally reset in the sanitization pass.
    // Importing the current API router pulls env-backed settings parsing at module load,
    // which is not yet safe to exercise as a sanitized sample without product-code changes.
    it('is not implemented after sanitization reset', () => {
        expect('Not implemented after sanitization reset.').toBe('Implemented');
    });
});
