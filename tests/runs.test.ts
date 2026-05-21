import { describe, expect, it } from 'vitest';

describe('V2 run coordinator', () => {
    it('rejects empty prompts after trimming', () => {
        expect.fail('Not implemented.');
    });

    it('clamps retrievalTurnLimit to configured bounds', () => {
        expect.fail('Not implemented.');
    });

    it('blocks runs while refresh is active', () => {
        expect.fail('Not implemented.');
    });

    it('requires a persisted session during phase 1 assistant runs', () => {
        expect.fail('Not implemented.');
    });

    it('rejects unsupported run modes', () => {
        expect.fail('Not implemented.');
    });

    it('rejects missing sessions', () => {
        expect.fail('Not implemented.');
    });

    it('rejects session mode mismatches', () => {
        expect.fail('Not implemented.');
    });

    it('persists the run row session row update and user entry before model execution', () => {
        expect.fail('Not implemented.');
    });

    it('persists reasoning entries in sequence order as tool calls arrive', () => {
        expect.fail('Not implemented.');
    });

    it('persists the final response entry and clears activeRunId on success', () => {
        expect.fail('Not implemented.');
    });

    it('updates the session title only on the first assistant response', () => {
        expect.fail('Not implemented.');
    });

    it('preserves the existing session title on later runs', () => {
        expect.fail('Not implemented.');
    });

    it('records failed runs and clears activeRunId when execution throws', () => {
        expect.fail('Not implemented.');
    });

    it('omits historical reasoning entries from reconstructed chat history', () => {
        expect.fail('Not implemented.');
    });

    it('includes party context only when requested', () => {
        expect.fail('Not implemented.');
    });

    it('requests party context from the corpus service only when enabled', () => {
        expect.fail('Not implemented.');
    });
});
