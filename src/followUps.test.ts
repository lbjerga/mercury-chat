/**
 * followUps.test.ts — Tests for follow-up suggestion generation
 */
import { describe, it, expect } from 'vitest';
import { generateFollowUps } from './chat/followUps';

describe('generateFollowUps', () => {
    it('returns code-mode suggestions', () => {
        const result = generateFollowUps('code', undefined);
        expect(result).toContain('Run the tests');
        expect(result).toContain('Add error handling');
        expect(result.length).toBeLessThanOrEqual(4);
    });

    it('returns plan-mode suggestions', () => {
        const result = generateFollowUps('plan', undefined);
        expect(result).toContain('Now implement this');
        expect(result).toContain('What are the trade-offs?');
    });

    it('returns default suggestions for unknown/undefined mode', () => {
        const result = generateFollowUps(undefined, undefined);
        expect(result).toContain('Explain more');
        expect(result).toContain('Show me an example');
    });

    it('returns default suggestions for chat mode', () => {
        const result = generateFollowUps('chat', undefined);
        expect(result).toContain('Explain more');
    });

    it('prepends "Fix the errors" when diagnostics present', () => {
        const afc = {
            path: 'test.ts',
            language: 'typescript',
            lineCount: 100,
            diagnostics: [{ line: 1, severity: 'error', message: 'oops' }],
        };
        const result = generateFollowUps('code', afc);
        expect(result[0]).toBe('Fix the errors in my file');
        expect(result.length).toBeLessThanOrEqual(4);
    });

    it('does not prepend error fix when no diagnostics', () => {
        const afc = {
            path: 'test.ts',
            language: 'typescript',
            lineCount: 100,
            diagnostics: [],
        };
        const result = generateFollowUps('code', afc);
        expect(result[0]).not.toBe('Fix the errors in my file');
    });

    it('limits to 4 suggestions max', () => {
        const afc = {
            path: 'test.ts',
            language: 'typescript',
            lineCount: 100,
            diagnostics: [{ line: 1, severity: 'error', message: 'err' }],
        };
        const result = generateFollowUps('code', afc);
        expect(result.length).toBe(4);
    });
});
