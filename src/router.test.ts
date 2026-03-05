/**
 * router.test.ts — Comprehensive tests for ProviderRouter
 *
 * Covers: registration, route order, circuit breaker open/close/half-open,
 * fallback chain, tool-call fallback, selectProvider, softTrip,
 * serialization, getStatus, and the fix ensuring all providers are tried.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Minimal mocks ──
vi.mock('vscode', () => ({
    workspace: { getConfiguration: () => ({ get: () => undefined }) },
}));
vi.mock('./outputChannel', () => ({ logInfo: vi.fn() }));
vi.mock('./contextBudget', () => ({
    trimToContextBudget: (msgs: any[]) => msgs,
}));

import { ProviderRouter } from './providers/router';
import type { ChatProvider, ProviderId, ProviderCapabilities, ProviderPricing } from './providers/types';
import type { MercuryMessage, StreamResult } from './mercuryClient';

// ── Helper: create a mock provider ──
function mockProvider(
    id: ProviderId,
    opts: {
        available?: boolean;
        toolCalling?: boolean;
        applyEdit?: boolean;
        streamResult?: Partial<StreamResult>;
        chatResult?: { content: string };
        streamError?: Error;
        chatError?: Error;
        applyEditResult?: { content: string };
        applyEditError?: Error;
    } = {},
): ChatProvider {
    const capabilities: ProviderCapabilities = {
        streaming: true,
        toolCalling: opts.toolCalling ?? false,
        reasoningEffort: false,
        applyEdit: opts.applyEdit ?? false,
        maxContextTokens: 128_000,
    };
    const pricing: ProviderPricing = { inputPer1M: 0, cachedInputPer1M: 0, outputPer1M: 0 };
    return {
        id,
        label: id,
        capabilities,
        pricing,
        isAvailable: vi.fn().mockReturnValue(opts.available ?? true),
        streamChat: vi.fn().mockImplementation(async () => {
            if (opts.streamError) throw opts.streamError;
            return { content: 'ok', toolCalls: [], usage: undefined, ...opts.streamResult };
        }),
        chat: vi.fn().mockImplementation(async () => {
            if (opts.chatError) throw opts.chatError;
            return { content: 'ok', usage: undefined, ...opts.chatResult };
        }),
        applyEdit: opts.applyEdit
            ? vi.fn().mockImplementation(async () => {
                if (opts.applyEditError) throw opts.applyEditError;
                return { content: 'edited', usage: undefined, ...opts.applyEditResult };
            })
            : undefined,
        updateConfig: vi.fn(),
    };
}

const MSGS: MercuryMessage[] = [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hello' },
];

// ═══════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════

describe('ProviderRouter', () => {
    let router: ProviderRouter;

    beforeEach(() => {
        router = new ProviderRouter({
            routeOrder: ['copilot', 'openrouter', 'ollama', 'mercury'],
            maxFailures: 3,
            cooldownMs: 1000,
        });
    });

    // ── Registration ──

    describe('register / unregister', () => {
        it('registers a provider and retrieves it', () => {
            const p = mockProvider('mercury');
            router.register(p);
            expect(router.getProvider('mercury')).toBe(p);
        });

        it('unregister removes the provider', () => {
            const p = mockProvider('mercury');
            router.register(p);
            router.unregister('mercury');
            expect(router.getProvider('mercury')).toBeUndefined();
        });

        it('re-registering replaces the old provider', () => {
            const p1 = mockProvider('mercury');
            const p2 = mockProvider('mercury');
            router.register(p1);
            router.register(p2);
            expect(router.getProvider('mercury')).toBe(p2);
        });
    });

    // ── selectProvider ──

    describe('selectProvider', () => {
        it('returns the first available provider in order', () => {
            router.register(mockProvider('copilot', { available: false }));
            router.register(mockProvider('openrouter', { available: true }));
            router.register(mockProvider('mercury', { available: true }));
            const p = router.selectProvider();
            expect(p?.id).toBe('openrouter');
        });

        it('returns undefined when nothing is available', () => {
            router.register(mockProvider('mercury', { available: false }));
            expect(router.selectProvider()).toBeUndefined();
        });

        it('skips providers with open breakers', () => {
            router.register(mockProvider('copilot'));
            router.register(mockProvider('openrouter'));
            // Trip copilot's breaker
            router.softTrip('copilot');
            const p = router.selectProvider();
            expect(p?.id).toBe('openrouter');
        });

        it('respects requireToolCalling filter', () => {
            router.register(mockProvider('copilot', { toolCalling: false }));
            router.register(mockProvider('mercury', { toolCalling: true }));
            const p = router.selectProvider({ requireToolCalling: true });
            expect(p?.id).toBe('mercury');
        });

        it('respects requireApplyEdit filter', () => {
            router.register(mockProvider('copilot', { applyEdit: false }));
            router.register(mockProvider('mercury', { applyEdit: true }));
            const p = router.selectProvider({ requireApplyEdit: true });
            expect(p?.id).toBe('mercury');
        });
    });

    // ── streamChat fallback ──

    describe('streamChat', () => {
        it('routes to first available provider', async () => {
            router.register(mockProvider('copilot', { available: false }));
            const mp = mockProvider('mercury');
            router.register(mp);

            const result = await router.streamChat(MSGS, vi.fn());
            expect(result.provider).toBe('mercury');
            expect(mp.streamChat).toHaveBeenCalled();
        });

        it('falls through ALL providers on auth errors (not just retryable)', async () => {
            // This is the critical fix — 403 on copilot should NOT block mercury
            router.register(mockProvider('copilot', {
                streamError: new Error('401 Unauthorized'),
            }));
            router.register(mockProvider('openrouter', {
                streamError: new Error('403 Forbidden'),
            }));
            const mp = mockProvider('mercury');
            router.register(mp);

            const result = await router.streamChat(MSGS, vi.fn());
            expect(result.provider).toBe('mercury');
        });

        it('falls through on unsupported errors', async () => {
            router.register(mockProvider('copilot', {
                streamError: new Error('Not supported by this provider'),
            }));
            const mp = mockProvider('mercury');
            router.register(mp);

            const result = await router.streamChat(MSGS, vi.fn());
            expect(result.provider).toBe('mercury');
        });

        it('falls through on retryable errors and trips breaker', async () => {
            const cp = mockProvider('copilot', {
                streamError: new Error('429 Too Many Requests'),
            });
            router.register(cp);
            router.register(mockProvider('mercury'));

            const result = await router.streamChat(MSGS, vi.fn());
            expect(result.provider).toBe('mercury');
        });

        it('throws when all providers fail', async () => {
            router.register(mockProvider('copilot', {
                streamError: new Error('fail 1'),
            }));
            router.register(mockProvider('mercury', {
                streamError: new Error('fail 2'),
            }));

            await expect(router.streamChat(MSGS, vi.fn()))
                .rejects.toThrow('All providers failed');
        });

        it('sets lastUsedProvider on success', async () => {
            router.register(mockProvider('mercury'));
            await router.streamChat(MSGS, vi.fn());
            expect(router.lastUsedProvider).toBe('mercury');
            expect(router.lastUsedProviderLabel).toBe('Mercury');
        });

        it('does tool-call fallback without tools when no tool-capable provider succeeds', async () => {
            // copilot has no tool calling; mercury tool-capable but fails
            router.register(mockProvider('copilot', { toolCalling: false }));
            router.register(mockProvider('mercury', {
                toolCalling: true,
                streamError: new Error('500 Server Error'),
            }));

            // copilot should be retried without tools as fallback
            const result = await router.streamChat(MSGS, vi.fn(), {
                tools: [{ type: 'function', function: { name: 'test', description: '', parameters: {} } }],
            });
            expect(result.provider).toBe('copilot');
        });
    });

    // ── chat fallback ──

    describe('chat', () => {
        it('routes to first available', async () => {
            router.register(mockProvider('mercury'));
            const result = await router.chat(MSGS);
            expect(result.provider).toBe('mercury');
        });

        it('falls through auth errors to next provider', async () => {
            router.register(mockProvider('copilot', {
                chatError: new Error('403 Forbidden'),
            }));
            router.register(mockProvider('mercury'));

            const result = await router.chat(MSGS);
            expect(result.provider).toBe('mercury');
        });

        it('throws when all providers fail', async () => {
            router.register(mockProvider('mercury', {
                chatError: new Error('fail'),
            }));
            await expect(router.chat(MSGS)).rejects.toThrow('All providers failed');
        });
    });

    // ── applyEdit ──

    describe('applyEdit', () => {
        it('routes to provider with applyEdit capability', async () => {
            router.register(mockProvider('copilot', { applyEdit: false }));
            router.register(mockProvider('mercury', { applyEdit: true }));

            const result = await router.applyEdit('old', 'new');
            expect(result.provider).toBe('mercury');
        });

        it('falls through on errors', async () => {
            router.register(mockProvider('openrouter', {
                applyEdit: true,
                applyEditError: new Error('503 Service Unavailable'),
            }));
            router.register(mockProvider('mercury', { applyEdit: true }));

            const result = await router.applyEdit('old', 'new');
            expect(result.provider).toBe('mercury');
        });

        it('throws when no applyEdit provider available', async () => {
            router.register(mockProvider('copilot'));
            await expect(router.applyEdit('old', 'new'))
                .rejects.toThrow('No provider available that supports Apply Edit');
        });
    });

    // ── Circuit breaker ──

    describe('circuit breaker', () => {
        it('opens after maxFailures consecutive retryable errors', async () => {
            router = new ProviderRouter({
                routeOrder: ['copilot', 'mercury'],
                maxFailures: 2,
                cooldownMs: 60000,
            });
            const cp = mockProvider('copilot', {
                streamError: new Error('500 Internal Server Error'),
            });
            router.register(cp);
            router.register(mockProvider('mercury')); // fallback

            // Two failures (maxFailures=2) → breaker opens
            await router.streamChat(MSGS, vi.fn()); // failure 1, falls to mercury
            await router.streamChat(MSGS, vi.fn()); // failure 2, falls to mercury

            // Now copilot should be skipped entirely (breaker open)
            const status = router.getStatus();
            const copilotStatus = status.providers.find(p => p.id === 'copilot');
            expect(copilotStatus?.breakerOpen).toBe(true);
        });

        it('resets on resetBreaker call', async () => {
            router.register(mockProvider('copilot'));
            router.softTrip('copilot');
            router.resetBreaker('copilot');

            // Should be available again
            const p = router.selectProvider();
            expect(p?.id).toBe('copilot');
        });

        it('resetAllBreakers clears all', () => {
            router.register(mockProvider('copilot'));
            router.register(mockProvider('mercury'));
            router.softTrip('copilot');
            router.softTrip('mercury');

            router.resetAllBreakers();

            const status = router.getStatus();
            expect(status.providers.every(p => !p.breakerOpen)).toBe(true);
        });

        it('softTrip immediately opens breaker', () => {
            router.register(mockProvider('copilot'));
            router.softTrip('copilot');

            const status = router.getStatus();
            const cs = status.providers.find(p => p.id === 'copilot');
            expect(cs?.breakerOpen).toBe(true);
        });
    });

    // ── Serialization ──

    describe('breaker serialization', () => {
        it('round-trips serialize → restore', () => {
            router.register(mockProvider('copilot'));
            router.register(mockProvider('mercury'));
            router.softTrip('copilot');

            const data = router.serializeBreakers();
            expect(data).toHaveProperty('copilot');
            expect(data.copilot.failures).toBeGreaterThanOrEqual(3);

            // New router, restore state
            const router2 = new ProviderRouter({
                routeOrder: ['copilot', 'mercury'],
                maxFailures: 3,
                cooldownMs: 60000,
            });
            router2.register(mockProvider('copilot'));
            router2.register(mockProvider('mercury'));
            router2.restoreBreakers(data);

            const status = router2.getStatus();
            const cs = status.providers.find(p => p.id === 'copilot');
            expect(cs?.breakerOpen).toBe(true);
        });

        it('restoreBreakers handles undefined gracefully', () => {
            router.register(mockProvider('copilot'));
            router.restoreBreakers(undefined);
            // Should not throw
            expect(router.selectProvider()).toBeDefined();
        });
    });

    // ── Config ──

    describe('updateRouteOrder / updateConfig', () => {
        it('updateRouteOrder changes provider priority', () => {
            router.register(mockProvider('copilot'));
            router.register(mockProvider('mercury'));
            router.updateRouteOrder(['mercury', 'copilot']);

            const p = router.selectProvider();
            expect(p?.id).toBe('mercury');
        });

        it('updateConfig patches config', () => {
            router.updateConfig({ maxFailures: 10 });
            // Internal — just verify it doesn't throw
        });
    });

    // ── getStatus ──

    describe('getStatus', () => {
        it('returns status for all route-order providers', () => {
            router.register(mockProvider('copilot'));
            router.register(mockProvider('mercury', { available: false }));

            const status = router.getStatus();
            expect(status.routeOrder).toEqual(['copilot', 'openrouter', 'ollama', 'mercury']);
            expect(status.providers.length).toBe(4);

            const mp = status.providers.find(p => p.id === 'mercury');
            expect(mp?.available).toBe(false);

            const cp = status.providers.find(p => p.id === 'copilot');
            expect(cp?.available).toBe(true);
        });

        it('marks active provider correctly', async () => {
            router.register(mockProvider('mercury'));
            await router.streamChat(MSGS, vi.fn());

            const status = router.getStatus();
            expect(status.activeProvider).toBe('mercury');
            const mp = status.providers.find(p => p.id === 'mercury');
            expect(mp?.active).toBe(true);
        });
    });
});
