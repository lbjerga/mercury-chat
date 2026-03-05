/**
 * tokenTracker.test.ts — Tests for token usage tracking, cost calculation, budgets
 */
import { describe, it, expect, beforeEach } from 'vitest';

// Import the class directly rather than the singleton so each test gets a fresh instance
// The singleton is just `new TokenTracker()`, so we test through it after a reset.
import { tokenTracker } from './tokenTracker';

function makeRequest(overrides: Record<string, unknown> = {}) {
    return {
        model: 'mercury-2',
        effort: 'medium',
        command: 'chat',
        provider: 'mercury' as const,
        apiInputTokens: undefined as number | undefined,
        apiOutputTokens: undefined as number | undefined,
        apiTotalTokens: undefined as number | undefined,
        estimatedInputChars: 400,
        estimatedOutputChars: 800,
        toolCalls: 0,
        rounds: 1,
        durationMs: 1000,
        ...overrides,
    };
}

describe('TokenTracker', () => {
    beforeEach(() => {
        tokenTracker.resetSession();
    });

    // ── Estimation ──
    describe('estimateTokens', () => {
        it('estimates ~4 chars per token', () => {
            expect(tokenTracker.estimateTokens(400)).toBe(100);
        });

        it('rounds up', () => {
            expect(tokenTracker.estimateTokens(5)).toBe(2); // ceil(5/4)
        });

        it('handles 0', () => {
            expect(tokenTracker.estimateTokens(0)).toBe(0);
        });
    });

    describe('estimateInputFromMessages', () => {
        it('sums content + overhead', () => {
            const msgs = [
                { role: 'user', content: 'hello world' }, // 11 + 10 = 21 chars
                { role: 'assistant', content: 'hi' },      // 2 + 10 = 12 chars
            ];
            const tokens = tokenTracker.estimateInputFromMessages(msgs);
            // (21 + 12) / 4 * calibration ~ 33/4 = ceil(8.25) = 9 (at factor=1)
            expect(tokens).toBeGreaterThan(0);
        });

        it('handles null content', () => {
            const msgs = [{ role: 'user', content: null }];
            const tokens = tokenTracker.estimateInputFromMessages(msgs);
            expect(tokens).toBeGreaterThanOrEqual(0);
        });
    });

    describe('estimateOutputFromResponse', () => {
        it('estimates from text length', () => {
            const tokens = tokenTracker.estimateOutputFromResponse('a'.repeat(100));
            expect(tokens).toBe(25); // 100/4
        });
    });

    // ── Recording ──
    describe('recordRequest', () => {
        it('records a request and returns the record', () => {
            const rec = tokenTracker.recordRequest(makeRequest());
            expect(rec.model).toBe('mercury-2');
            expect(rec.provider).toBe('mercury');
            expect(rec.costUsd).toBeGreaterThan(0);
            expect(rec.timestamp).toBeGreaterThan(0);
        });

        it('uses API tokens when provided', () => {
            const rec = tokenTracker.recordRequest(makeRequest({
                apiInputTokens: 500,
                apiOutputTokens: 200,
                apiTotalTokens: 700,
            }));
            expect(rec.apiInputTokens).toBe(500);
            expect(rec.apiOutputTokens).toBe(200);
        });

        it('falls back to estimated tokens when API not provided', () => {
            const rec = tokenTracker.recordRequest(makeRequest({
                apiInputTokens: undefined,
                apiOutputTokens: undefined,
            }));
            expect(rec.estimatedInputTokens).toBeGreaterThan(0);
            expect(rec.estimatedOutputTokens).toBeGreaterThan(0);
        });

        it('calculates savings for non-Mercury providers', () => {
            const rec = tokenTracker.recordRequest(makeRequest({
                provider: 'copilot',
            }));
            // Copilot is free → cost should be 0, savings = mercury cost
            expect(rec.costUsd).toBe(0);
            expect(rec.savedUsd).toBeGreaterThan(0);
        });

        it('Ollama is free', () => {
            const rec = tokenTracker.recordRequest(makeRequest({
                provider: 'ollama',
            }));
            expect(rec.costUsd).toBe(0);
        });

        it('prunes records beyond 200', () => {
            for (let i = 0; i < 210; i++) {
                tokenTracker.recordRequest(makeRequest());
            }
            const stats = tokenTracker.getSessionStats();
            expect(stats.totalRequests).toBeLessThanOrEqual(200);
        });

        it('defaults provider to mercury', () => {
            const rec = tokenTracker.recordRequest(makeRequest({ provider: undefined }));
            expect(rec.provider).toBe('mercury');
        });
    });

    // ── Calibration ──
    describe('calibration', () => {
        it('resets to 1.0 after resetSession', () => {
            // Record something that shifts calibration
            tokenTracker.recordRequest(makeRequest({
                estimatedInputChars: 400,
                apiInputTokens: 800,
            }));
            expect(tokenTracker.calibrationFactor).not.toBe(1.0);

            tokenTracker.resetSession();
            expect(tokenTracker.calibrationFactor).toBe(1.0);
        });

        it('adjusts factor with EMA when API tokens provided', () => {
            // API says 200 tokens, we estimated 100 (400 chars / 4)
            tokenTracker.recordRequest(makeRequest({
                estimatedInputChars: 400,
                apiInputTokens: 200,
            }));
            // Factor should move towards 2.0 (200/100)
            expect(tokenTracker.calibrationFactor).toBeGreaterThan(1.0);
        });

        it('clamps factor within [0.5, 3.0]', () => {
            // Extreme ratio: API=1000, estimate=10 → ratio=100, but clamped to 3.0
            tokenTracker.recordRequest(makeRequest({
                estimatedInputChars: 40, // 10 tokens estimated
                apiInputTokens: 1000,
            }));
            expect(tokenTracker.calibrationFactor).toBeLessThanOrEqual(3.0);
        });
    });

    // ── Session stats ──
    describe('getSessionStats', () => {
        it('returns zeros when no requests', () => {
            const stats = tokenTracker.getSessionStats();
            expect(stats.totalRequests).toBe(0);
            expect(stats.totalCostUsd).toBe(0);
        });

        it('aggregates across multiple requests', () => {
            tokenTracker.recordRequest(makeRequest({ durationMs: 1000 }));
            tokenTracker.recordRequest(makeRequest({ durationMs: 2000 }));
            const stats = tokenTracker.getSessionStats();
            expect(stats.totalRequests).toBe(2);
            expect(stats.totalDurationMs).toBe(3000);
        });

        it('calculates average tokens per request', () => {
            tokenTracker.recordRequest(makeRequest());
            tokenTracker.recordRequest(makeRequest());
            const stats = tokenTracker.getSessionStats();
            expect(stats.avgTokensPerRequest).toBeGreaterThan(0);
        });
    });

    // ── get last request ──
    describe('getLastRequest', () => {
        it('returns undefined when no requests', () => {
            expect(tokenTracker.getLastRequest()).toBeUndefined();
        });

        it('returns the most recent request', () => {
            tokenTracker.recordRequest(makeRequest({ command: 'first' }));
            tokenTracker.recordRequest(makeRequest({ command: 'second' }));
            expect(tokenTracker.getLastRequest()?.command).toBe('second');
        });
    });

    // ── Budget ──
    describe('budget guardrails', () => {
        it('getSessionCost returns sum of costs', () => {
            tokenTracker.recordRequest(makeRequest());
            tokenTracker.recordRequest(makeRequest());
            expect(tokenTracker.getSessionCost()).toBeGreaterThan(0);
        });

        it('isOverBudget returns false when disabled (maxUsd=0)', () => {
            tokenTracker.recordRequest(makeRequest());
            expect(tokenTracker.isOverBudget(0)).toBe(false);
        });

        it('isOverBudget returns false when under limit', () => {
            tokenTracker.recordRequest(makeRequest());
            expect(tokenTracker.isOverBudget(100)).toBe(false);
        });

        it('isOverBudget returns true when exceeded', () => {
            // Record many requests to accumulate cost
            for (let i = 0; i < 100; i++) {
                tokenTracker.recordRequest(makeRequest({
                    apiInputTokens: 50000,
                    apiOutputTokens: 50000,
                }));
            }
            // Mercury pricing: ~100K tokens × 100 requests = should be well over $1
            expect(tokenTracker.isOverBudget(0.001)).toBe(true);
        });

        it('getBudgetWarning includes cost info', () => {
            tokenTracker.recordRequest(makeRequest());
            const warning = tokenTracker.getBudgetWarning(1.0);
            expect(warning).toContain('$');
            expect(warning).toContain('budget');
        });

        it('getLastRequestCost returns 0 when no requests', () => {
            expect(tokenTracker.getLastRequestCost()).toBe(0);
        });
    });

    // ── Formatting ──
    describe('formatFooterStats', () => {
        it('returns a non-empty string', () => {
            const rec = tokenTracker.recordRequest(makeRequest());
            const footer = tokenTracker.formatFooterStats(rec);
            expect(footer.length).toBeGreaterThan(0);
            expect(footer).toContain('tokens');
            expect(footer).toContain('Session');
        });
    });

    describe('formatDetailedReport', () => {
        it('includes header and cost info', () => {
            tokenTracker.recordRequest(makeRequest());
            const report = tokenTracker.formatDetailedReport();
            expect(report).toContain('Mercury Token Usage');
            expect(report).toContain('Total Cost');
            expect(report).toContain('#1');
        });
    });

    // ── Persistence ──
    describe('toJSON / fromJSON', () => {
        it('round-trips data', () => {
            tokenTracker.recordRequest(makeRequest({ command: 'chat' }));
            tokenTracker.recordRequest(makeRequest({ command: 'code' }));

            const json = tokenTracker.toJSON();
            expect(json.requests).toHaveLength(2);
            expect(json.sessionStart).toBeGreaterThan(0);

            tokenTracker.resetSession();
            expect(tokenTracker.getSessionStats().totalRequests).toBe(0);

            tokenTracker.fromJSON(json);
            expect(tokenTracker.getSessionStats().totalRequests).toBe(2);
        });

        it('fromJSON handles empty/undefined data', () => {
            tokenTracker.fromJSON({});
            expect(tokenTracker.getSessionStats().totalRequests).toBe(0);
        });
    });

    // ── Reset ──
    describe('resetSession', () => {
        it('clears all requests', () => {
            tokenTracker.recordRequest(makeRequest());
            tokenTracker.resetSession();
            expect(tokenTracker.getSessionStats().totalRequests).toBe(0);
            expect(tokenTracker.getLastRequest()).toBeUndefined();
        });
    });
});
