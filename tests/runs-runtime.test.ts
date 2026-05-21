import { describe, expect, it } from 'vitest';

describe('V2 run runtime', () => {
    it('loads assistant prompt assets from tracked markdown files', () => {
        expect.fail('Not implemented.');
    });

    it('builds assistant messages with shared prompt assistant prompt optional session titling and additional context', () => {
        expect.fail('Not implemented.');
    });

    it('includes explicit omitted-party-context instruction when party context is disabled', () => {
        expect.fail('Not implemented.');
    });

    it('formats initial retrieval evidence into the user message', () => {
        expect.fail('Not implemented.');
    });

    it('returns a final response when the first structured reply is already valid', () => {
        expect.fail('Not implemented.');
    });

    it('repairs an invalid final envelope once before failing', () => {
        expect.fail('Not implemented.');
    });

    it('fails when a tool-call reply omits a valid thinking block', () => {
        expect.fail('Not implemented.');
    });

    it('consumes retrieval turns only for valid search_corpus calls', () => {
        expect.fail('Not implemented.');
    });

    it('returns tool errors for unsupported tool names', () => {
        expect.fail('Not implemented.');
    });

    it('returns tool errors for invalid tool-call JSON', () => {
        expect.fail('Not implemented.');
    });

    it('returns tool errors for missing query or userMessage', () => {
        expect.fail('Not implemented.');
    });

    it('enforces sourceTypes validation', () => {
        expect.fail('Not implemented.');
    });

    it('clamps evidence limit per tool call', () => {
        expect.fail('Not implemented.');
    });

    it('stops offering tools after retrieval turns are exhausted', () => {
        expect.fail('Not implemented.');
    });

    it('formats empty retrieval results with the unsupported-answer guidance', () => {
        expect.fail('Not implemented.');
    });
});
