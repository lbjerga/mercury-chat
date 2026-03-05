/**
 * providers/router.ts — Multi-provider router with circuit breaker
 *
 * Routing order (user-configured, default):
 *   Copilot → OpenRouter → Ollama → Mercury
 *
 * On each request the router walks the fallback chain:
 *  1. Skip providers whose circuit breaker is OPEN.
 *  2. Skip providers that are not available (missing API key, etc.).
 *  3. If the request requires tool calling, skip providers without that capability.
 *  4. Try the first eligible provider.
 *  5. On ANY failure → log it, try next provider.
 *  6. Only transient errors (rate-limit, timeout, 5xx, network) trip the circuit breaker.
 *
 * Circuit breaker logic:
 *  - After `maxFailures` consecutive transient failures → OPEN (provider disabled).
 *  - After `cooldownMs` → HALF-OPEN (one probe request; success → CLOSED).
 */

import * as vscode from 'vscode';
import { MercuryMessage, StreamResult, TokenUsage } from '../mercuryClient';
import { logInfo } from '../outputChannel';
import { trimToContextBudget } from '../contextBudget';
import {
    ChatProvider,
    ChatRequestOptions,
    CircuitBreakerState,
    ProviderId,
    RouterConfig,
    DEFAULT_ROUTE_ORDER,
    DEFAULT_MAX_FAILURES,
    DEFAULT_COOLDOWN_MS,
    classifyError,
    isRetryableError,
    PROVIDER_LABELS,
} from './types';

// ──────────────────────────────────────────────
// Router
// ──────────────────────────────────────────────

export class ProviderRouter {
    private _providers: Map<ProviderId, ChatProvider> = new Map();
    private _breakers: Map<ProviderId, CircuitBreakerState> = new Map();
    private _config: RouterConfig;

    /** The provider that handled the most recent request (for UI display) */
    private _lastUsedProvider?: ProviderId;

    constructor(config?: Partial<RouterConfig>) {
        this._config = {
            routeOrder: config?.routeOrder ?? [...DEFAULT_ROUTE_ORDER],
            maxFailures: config?.maxFailures ?? DEFAULT_MAX_FAILURES,
            cooldownMs: config?.cooldownMs ?? DEFAULT_COOLDOWN_MS,
        };
    }

    // ── Provider registration ──

    register(provider: ChatProvider): void {
        this._providers.set(provider.id, provider);
        this._breakers.set(provider.id, { failures: 0 });
    }

    unregister(id: ProviderId): void {
        this._providers.delete(id);
        this._breakers.delete(id);
    }

    getProvider(id: ProviderId): ChatProvider | undefined {
        return this._providers.get(id);
    }

    get lastUsedProvider(): ProviderId | undefined {
        return this._lastUsedProvider;
    }

    get lastUsedProviderLabel(): string {
        return this._lastUsedProvider ? PROVIDER_LABELS[this._lastUsedProvider] : 'None';
    }

    // ── Configuration ──

    updateRouteOrder(order: ProviderId[]): void {
        this._config.routeOrder = order;
    }

    updateConfig(partial: Partial<RouterConfig>): void {
        Object.assign(this._config, partial);
    }

    // ── Circuit breaker helpers ──

    private _isBreakerOpen(id: ProviderId): boolean {
        const state = this._breakers.get(id);
        if (!state || state.failures < this._config.maxFailures) { return false; }
        // Check if cooldown has elapsed → half-open
        if (state.openedAt && Date.now() - state.openedAt >= this._config.cooldownMs) {
            state.halfOpenAt = Date.now();
            return false; // allow one probe
        }
        return true;
    }

    private _recordSuccess(id: ProviderId): void {
        const state = this._breakers.get(id);
        if (state) {
            state.failures = 0;
            state.openedAt = undefined;
            state.halfOpenAt = undefined;
        }
    }

    private _recordFailure(id: ProviderId): void {
        const state = this._breakers.get(id) ?? { failures: 0 };
        state.failures++;
        if (state.failures >= this._config.maxFailures) {
            state.openedAt = Date.now();
            logInfo(`[Router] Circuit breaker OPEN for ${PROVIDER_LABELS[id]} after ${state.failures} failures`);
        }
        this._breakers.set(id, state);
    }

    /** Reset circuit breaker for a provider (e.g. when user changes settings) */
    resetBreaker(id: ProviderId): void {
        this._breakers.set(id, { failures: 0 });
    }

    /** Temporarily trip a provider's breaker (e.g. when quality is poor but request didn't fail) */
    softTrip(id: ProviderId): void {
        const state = this._breakers.get(id) ?? { failures: 0 };
        state.failures = this._config.maxFailures;
        state.openedAt = Date.now();
        this._breakers.set(id, state);
        logInfo(`[Router] Soft-tripped ${PROVIDER_LABELS[id]} (quality issue)`);
    }

    resetAllBreakers(): void {
        for (const id of this._breakers.keys()) {
            this._breakers.set(id, { failures: 0 });
        }
    }

    // ── Persistence (#20) ──

    /** Serialize circuit breaker state for storage */
    serializeBreakers(): Record<string, { failures: number; openedAt?: number }> {
        const data: Record<string, { failures: number; openedAt?: number }> = {};
        for (const [id, state] of this._breakers) {
            if (state.failures > 0) {
                data[id] = { failures: state.failures, openedAt: state.openedAt };
            }
        }
        return data;
    }

    /** Restore circuit breaker state from storage */
    restoreBreakers(data: Record<string, { failures: number; openedAt?: number }> | undefined): void {
        if (!data) { return; }
        for (const [id, saved] of Object.entries(data)) {
            const existing = this._breakers.get(id as ProviderId);
            if (existing) {
                existing.failures = saved.failures;
                existing.openedAt = saved.openedAt;
            }
        }
    }

    // ── Eligibility ──

    private _isEligible(
        provider: ChatProvider,
        requireToolCalling: boolean,
        requireApplyEdit: boolean,
    ): boolean {
        if (!provider.isAvailable()) { return false; }
        if (this._isBreakerOpen(provider.id)) { return false; }
        if (requireToolCalling && !provider.capabilities.toolCalling) { return false; }
        if (requireApplyEdit && !provider.capabilities.applyEdit) { return false; }
        return true;
    }

    /**
     * Pick the best eligible provider in order, without executing a request.
     * Useful for UI display ("Using: Copilot").
     */
    selectProvider(opts?: { requireToolCalling?: boolean; requireApplyEdit?: boolean }): ChatProvider | undefined {
        for (const id of this._config.routeOrder) {
            const provider = this._providers.get(id);
            if (provider && this._isEligible(provider, opts?.requireToolCalling ?? false, opts?.requireApplyEdit ?? false)) {
                return provider;
            }
        }
        return undefined;
    }

    // ── Core routing methods ──

    /**
     * Streaming chat with automatic fallback.
     */
    async streamChat(
        messages: MercuryMessage[],
        onToken: (token: string) => void,
        options?: ChatRequestOptions,
    ): Promise<StreamResult & { provider: ProviderId }> {
        const requireToolCalling = !!(options?.tools && options.tools.length > 0);
        const errors: string[] = [];

        for (const id of this._config.routeOrder) {
            const provider = this._providers.get(id);
            if (!provider || !this._isEligible(provider, requireToolCalling, false)) {
                continue;
            }

            try {
                logInfo(`[Router] Attempting streamChat via ${PROVIDER_LABELS[id]}`);
                const trimmed = trimToContextBudget(messages, { maxContextTokens: provider.capabilities.maxContextTokens });
                const result = await provider.streamChat(trimmed, onToken, options);
                this._recordSuccess(id);
                this._lastUsedProvider = id;
                return { ...result, provider: id };
            } catch (err: unknown) {
                const kind = classifyError(err);
                const errMsg = err instanceof Error ? err.message : String(err);
                errors.push(`${PROVIDER_LABELS[id]}: ${errMsg}`);
                logInfo(`[Router] ${PROVIDER_LABELS[id]} failed (${kind}): ${errMsg}`);

                // Always try the next provider — an auth/unsupported error on
                // provider A says nothing about provider B. Only bump the
                // circuit breaker for transient errors (rate-limit, timeout, etc.).
                if (isRetryableError(kind)) {
                    this._recordFailure(id);
                }
                continue;
            }
        }

        // Tool-call fallback: if tools were required but no tool-capable provider succeeded,
        // retry without tools so a non-tool-capable provider (e.g. Copilot) can still respond
        if (requireToolCalling) {
            logInfo('[Router] No tool-capable provider succeeded — retrying without tools');
            const fallbackOptions = options ? { ...options, tools: undefined } : undefined;
            for (const id of this._config.routeOrder) {
                const provider = this._providers.get(id);
                if (!provider || !this._isEligible(provider, false, false)) { continue; }
                try {
                    const trimmed = trimToContextBudget(messages, { maxContextTokens: provider.capabilities.maxContextTokens });
                    const result = await provider.streamChat(trimmed, onToken, fallbackOptions);
                    this._recordSuccess(id);
                    this._lastUsedProvider = id;
                    return { ...result, provider: id };
                } catch (fallbackErr: unknown) {
                    const kind = classifyError(fallbackErr);
                    if (isRetryableError(kind)) { this._recordFailure(id); }
                    continue;
                }
            }
        }

        throw new Error(
            `All providers failed.\n${errors.join('\n')}` +
            '\n\nCheck your API keys and network connectivity.'
        );
    }

    /**
     * Non-streaming chat with automatic fallback.
     */
    async chat(
        messages: MercuryMessage[],
        options?: ChatRequestOptions,
    ): Promise<{ content: string; usage?: TokenUsage; provider: ProviderId }> {
        const errors: string[] = [];

        for (const id of this._config.routeOrder) {
            const provider = this._providers.get(id);
            if (!provider || !this._isEligible(provider, false, false)) {
                continue;
            }

            try {
                logInfo(`[Router] Attempting chat via ${PROVIDER_LABELS[id]}`);
                const trimmed = trimToContextBudget(messages, { maxContextTokens: provider.capabilities.maxContextTokens });
                const result = await provider.chat(trimmed, options);
                this._recordSuccess(id);
                this._lastUsedProvider = id;
                return { ...result, provider: id };
            } catch (err: unknown) {
                const kind = classifyError(err);
                const errMsg = err instanceof Error ? err.message : String(err);
                errors.push(`${PROVIDER_LABELS[id]}: ${errMsg}`);
                logInfo(`[Router] ${PROVIDER_LABELS[id]} failed (${kind}): ${errMsg}`);

                if (isRetryableError(kind)) {
                    this._recordFailure(id);
                }
                continue;
            }
        }

        throw new Error(`All providers failed.\n${errors.join('\n')}`);
    }

    /**
     * Apply-edit: only Mercury supports this. Falls through to Mercury directly.
     */
    async applyEdit(
        originalCode: string,
        updateSnippet: string,
    ): Promise<{ content: string; usage?: TokenUsage; provider: ProviderId }> {
        // Walk the route order looking for a provider that supports applyEdit
        for (const id of this._config.routeOrder) {
            const provider = this._providers.get(id);
            if (!provider || !this._isEligible(provider, false, true)) { continue; }
            if (!provider.applyEdit) { continue; }

            try {
                const result = await provider.applyEdit(originalCode, updateSnippet);
                this._recordSuccess(id);
                this._lastUsedProvider = id;
                return { ...result, provider: id };
            } catch (err) {
                const kind = classifyError(err);
                if (isRetryableError(kind)) {
                    this._recordFailure(id);
                }
                continue;
            }
        }

        throw new Error('No provider available that supports Apply Edit');
    }

    // ── Status for UI ──

    /** Get a status summary for the status bar or webview */
    getStatus(): ProviderRouterStatus {
        const statuses: ProviderStatus[] = [];
        for (const id of this._config.routeOrder) {
            const provider = this._providers.get(id);
            const breaker = this._breakers.get(id);
            statuses.push({
                id,
                label: PROVIDER_LABELS[id],
                available: provider?.isAvailable() ?? false,
                breakerOpen: this._isBreakerOpen(id),
                failures: breaker?.failures ?? 0,
                active: id === this._lastUsedProvider,
            });
        }
        return {
            routeOrder: this._config.routeOrder,
            providers: statuses,
            activeProvider: this._lastUsedProvider,
        };
    }
}

// ── Status types ──

export interface ProviderStatus {
    id: ProviderId;
    label: string;
    available: boolean;
    breakerOpen: boolean;
    failures: number;
    active: boolean;
}

export interface ProviderRouterStatus {
    routeOrder: ProviderId[];
    providers: ProviderStatus[];
    activeProvider?: ProviderId;
}
