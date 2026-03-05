/**
 * modelSelector.test.ts — Tests for smart model selection heuristics
 */
import { describe, it, expect } from 'vitest';
import { classifyTier, selectModel } from './modelSelector';

describe('classifyTier', () => {
    // ── Heavy tasks ──
    describe('heavy', () => {
        it('high context tokens → heavy regardless of message', () => {
            expect(classifyTier('hello', 15000)).toBe('heavy');
        });

        it('refactor keyword → heavy', () => {
            expect(classifyTier('refactor the auth module', 5000)).toBe('heavy');
        });

        it('redesign keyword → heavy', () => {
            expect(classifyTier('redesign the routing', 3000)).toBe('heavy');
        });

        it('architect keyword → heavy', () => {
            expect(classifyTier('architect a new system', 2000)).toBe('heavy');
        });

        it('migration keyword → heavy', () => {
            expect(classifyTier('migration from v1 to v2', 2000)).toBe('heavy');
        });

        it('implement feature → heavy', () => {
            expect(classifyTier('implement auth feature', 2000)).toBe('heavy');
        });

        it('multi-file keyword → heavy', () => {
            expect(classifyTier('multi-file change please', 2000)).toBe('heavy');
        });

        it('rewrite keyword → heavy', () => {
            expect(classifyTier('rewrite the entire module', 1000)).toBe('heavy');
        });

        it('optimize keyword → heavy', () => {
            expect(classifyTier('optimize database queries', 1000)).toBe('heavy');
        });

        it('security audit → heavy', () => {
            expect(classifyTier('security audit of the code', 1000)).toBe('heavy');
        });

        it('unit test all/entire → heavy', () => {
            expect(classifyTier('unit test the entire project', 1000)).toBe('heavy');
        });
    });

    // ── Light tasks ──
    describe('light', () => {
        it('greeting → light', () => {
            expect(classifyTier('hi', 500)).toBe('light');
        });

        it('"what is" question → light with low tokens', () => {
            expect(classifyTier('what is a closure', 1000)).toBe('light');
        });

        it('"how to" question → light with low tokens', () => {
            expect(classifyTier('how to install npm', 500)).toBe('light');
        });

        it('quick question → light', () => {
            expect(classifyTier('quick question about imports', 1000)).toBe('light');
        });

        it('rename request → light', () => {
            expect(classifyTier('rename this variable', 500)).toBe('light');
        });

        it('fix typo → light', () => {
            expect(classifyTier('fix this typo', 500)).toBe('light');
        });

        it('short prompt with low context → light', () => {
            expect(classifyTier('help', 500)).toBe('light');
        });
    });

    // ── Medium tasks ──
    describe('medium', () => {
        it('moderate message with moderate context → medium', () => {
            expect(classifyTier('add error handling to the function and improve logging', 3000)).toBe('medium');
        });

        it('no special keywords, medium context → medium', () => {
            expect(classifyTier('write a function that parses CSV files and returns structured data', 5000)).toBe('medium');
        });
    });
});

describe('selectModel', () => {
    it('light tier → flash model + low effort', () => {
        const rec = selectModel('hi', 500);
        expect(rec.tier).toBe('light');
        expect(rec.openRouterModel).toContain('flash');
        expect(rec.mercuryEffort).toBe('low');
    });

    it('medium tier → no model override + medium effort', () => {
        const rec = selectModel('write a util function for parsing dates', 3000);
        expect(rec.tier).toBe('medium');
        expect(rec.openRouterModel).toBeUndefined();
        expect(rec.mercuryEffort).toBe('medium');
    });

    it('heavy tier → claude sonnet + high effort', () => {
        const rec = selectModel('refactor the entire codebase', 5000);
        expect(rec.tier).toBe('heavy');
        expect(rec.openRouterModel).toContain('claude');
        expect(rec.mercuryEffort).toBe('high');
    });
});
