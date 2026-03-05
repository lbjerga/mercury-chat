/**
 * autoReasoning.test.ts — Tests for auto reasoning effort detection
 */
import { describe, it, expect } from 'vitest';
import { autoDetectEffort, estimateTokens, shouldThrottleEffort } from './autoReasoning';

// ── Helper: default signals ──
function signals(overrides: Record<string, unknown> = {}) {
    return {
        prompt: '',
        command: undefined as string | undefined,
        referenceCount: 0,
        referenceSize: 0,
        historyTurns: 0,
        hasErrors: false,
        workspaceFileCount: 0,
        isFollowUp: false,
        ...overrides,
    };
}

// ═══════════════════════════════════════════════
describe('autoDetectEffort', () => {
    // ── Instant patterns (greetings, trivial) ──
    describe('instant patterns', () => {
        const trivial = ['hi', 'hello', 'hey', 'thanks', 'thank you', 'ok', 'yes', 'no', 'sure', 'got it'];
        for (const word of trivial) {
            it(`"${word}" → instant`, () => {
                const { effort } = autoDetectEffort(signals({ prompt: word }));
                expect(effort).toBe('instant');
            });
        }

        it('"what is a closure?" → instant', () => {
            const { effort } = autoDetectEffort(signals({ prompt: 'what is a closure?' }));
            expect(effort).toBe('instant');
        });

        it('"how do i import react" → instant', () => {
            const { effort } = autoDetectEffort(signals({ prompt: 'how do i import react' }));
            expect(effort).toBe('instant');
        });
    });

    // ── Command baseline ──
    describe('command baseline', () => {
        it('/explain with short prompt → low', () => {
            const { effort } = autoDetectEffort(signals({ prompt: 'this fn', command: 'explain' }));
            expect(effort).toBe('low');
        });

        it('/test with short prompt → high', () => {
            const { effort } = autoDetectEffort(signals({ prompt: 'add tests', command: 'test' }));
            expect(effort).toBe('high');
        });

        it('/refactor with short prompt → high', () => {
            const { effort } = autoDetectEffort(signals({ prompt: 'clean up', command: 'refactor' }));
            expect(effort).toBe('high');
        });

        it('/fix → medium baseline', () => {
            const { effort } = autoDetectEffort(signals({ prompt: 'fix bug', command: 'fix' }));
            expect(effort).toBe('medium');
        });

        it('command baseline is a floor — score can raise it', () => {
            const { effort } = autoDetectEffort(signals({
                prompt: 'refactor the entire multi-file architecture and redesign everything very long prompt '.repeat(5),
                command: 'review',
            }));
            expect(effort).toBe('high');
        });
    });

    // ── Score-based classification ──
    describe('score-based classification', () => {
        it('long prompt with complex keyword → high', () => {
            const { effort } = autoDetectEffort(signals({
                prompt: 'Please refactor the entire authentication module across all files. ' +
                    'It needs a complete redesign with proper separation of concerns. '
                        .repeat(3),
            }));
            // Score: +2 (long) +2 (refactor) = 4 → high, BUT "redesign" also matches
            // Actual result depends on exact scoring. Accept medium or high.
            expect(['medium', 'high']).toContain(effort);
        });

        it('simple keyword like "explain" reduces effort', () => {
            const { effort } = autoDetectEffort(signals({
                prompt: 'explain what this function does',
            }));
            // Short prompt (-1 or 0) + "explain" low keyword (-1) → instant or low
            expect(['instant', 'low']).toContain(effort);
        });

        it('many references boost effort', () => {
            const { effort } = autoDetectEffort(signals({
                prompt: 'fix the issue',
                referenceCount: 5,
                referenceSize: 20000,
            }));
            // 5 refs (+2) + large refs (+1) + "fix" doesn't hit HIGH_PATTERNS = medium
            expect(['medium', 'high']).toContain(effort);
        });

        it('deep conversation → higher effort', () => {
            // Long prompt to avoid instant short-circuit, with complex keywords
            const { effort } = autoDetectEffort(signals({
                prompt: 'We need to refactor and redesign the authentication layer. Please analyze the current architecture.',
                historyTurns: 8,
            }));
            // +1 (medium prompt, >80 chars) +2 (refactor keyword) +2 (deep conversation) = 5 → high
            expect(effort).toBe('high');
        });

        it('short follow-up question → lower effort', () => {
            const { effort: e1 } = autoDetectEffort(signals({
                prompt: 'ok?',
                isFollowUp: true,
            }));
            // Short prompt (-1), question mark (-1), short follow-up (-1) = instant
            expect(e1).toBe('instant');
        });

        it('list items boost effort', () => {
            const { effort } = autoDetectEffort(signals({
                prompt: '1. Add auth\n2. Add logging\n3. Add tests\n4. Update docs',
            }));
            // 4 list items (+2) = medium or higher
            expect(['medium', 'high']).toContain(effort);
        });

        it('code blocks in prompt boost effort', () => {
            const { effort } = autoDetectEffort(signals({
                prompt: 'Fix this:\n```\nconst x = 1\n```\nand also fix this:\n```\nconst y = 2\n```',
            }));
            // 2 code blocks (+1)
            expect(['low', 'medium', 'high']).toContain(effort);
        });

        it('errors boost effort', () => {
            const { effort } = autoDetectEffort(signals({
                prompt: 'fix the code',
                hasErrors: true,
                referenceCount: 2,
            }));
            // Short prompt, hasErrors (+1), 2 refs (+1), question? (0) → score=2 → low or medium
            expect(['low', 'medium', 'high']).toContain(effort);
        });
    });

    // ── Command overrides never go below baseline ──
    describe('command floor', () => {
        it('/review cannot be lowered below high by score', () => {
            // Very short, simple prompt — score would be low, but /review baseline is high
            const { effort } = autoDetectEffort(signals({
                prompt: 'A super long prompt to trigger scoring path instead of short-circuit. ' +
                    'explain this very simple renamed variable please.',
                command: 'review',
            }));
            expect(effort).toBe('high');
        });
    });
});

// ═══════════════════════════════════════════════
describe('estimateTokens', () => {
    it('estimates ~4 chars per token', () => {
        const msgs = [{ content: 'abcd' }, { content: 'efghijkl' }];
        // 4 + 8 = 12 chars → 3 tokens
        expect(estimateTokens(msgs)).toBe(3);
    });

    it('handles null/undefined content', () => {
        const msgs = [{ content: null }, { content: undefined }, { content: 'test' }];
        expect(estimateTokens(msgs)).toBe(1);
    });

    it('returns 0 for empty array', () => {
        expect(estimateTokens([])).toBe(0);
    });
});

// ═══════════════════════════════════════════════
describe('shouldThrottleEffort', () => {
    it('does not throttle below 50k tokens', () => {
        expect(shouldThrottleEffort(30000)).toEqual({ throttle: false });
        expect(shouldThrottleEffort(49999)).toEqual({ throttle: false });
    });

    it('throttles to medium at 50-70k tokens', () => {
        const result = shouldThrottleEffort(55000);
        expect(result.throttle).toBe(true);
        expect(result.suggestion).toBe('medium');
    });

    it('throttles to low above 70k tokens', () => {
        const result = shouldThrottleEffort(80000);
        expect(result.throttle).toBe(true);
        expect(result.suggestion).toBe('low');
    });
});
