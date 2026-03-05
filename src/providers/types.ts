/**
 * providers/types.ts — Shared types for the multi-provider abstraction layer
 *
 * All provider adapters implement ChatProvider. The router picks the
 * best available provider per-request based on the configured fallback
 * chain, circuit breaker state, and capability requirements.
 */

import { ToolDefinition, ToolCall } from '../types';

// ──────────────────────────────────────────────
// Message types (OpenAI-compatible, re-exported for convenience)
// ──────────────────────────────────────────────

export { MercuryMessage, MercuryTextMessage, MercuryToolCallMessage, MercuryToolResultMessage, TokenUsage, StreamResult } from '../mercuryClient';

// ──────────────────────────────────────────────
// Provider identity
// ──────────────────────────────────────────────

export type ProviderId = 'copilot' | 'openrouter' | 'ollama' | 'mercury';

/** Human-readable names for UI display */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
    copilot: 'Copilot',
    openrouter: 'OpenRouter',
    ollama: 'Ollama (Local)',
    mercury: 'Mercury',
};

// ──────────────────────────────────────────────
// Provider capabilities
// ──────────────────────────────────────────────

export interface ProviderCapabilities {
    /** Supports streaming responses */
    streaming: boolean;
    /** Supports tool/function calling */
    toolCalling: boolean;
    /** Supports the reasoning_effort parameter */
    reasoningEffort: boolean;
    /** Supports the Mercury Edit endpoint */
    applyEdit: boolean;
    /** Maximum context window tokens (0 = unknown) */
    maxContextTokens: number;
}

// ──────────────────────────────────────────────
// Provider pricing (per 1M tokens, USD)
// ──────────────────────────────────────────────

export interface ProviderPricing {
    inputPer1M: number;
    cachedInputPer1M: number;
    outputPer1M: number;
}

export const PROVIDER_PRICING: Record<ProviderId, ProviderPricing> = {
    copilot: { inputPer1M: 0, cachedInputPer1M: 0, outputPer1M: 0 },           // Free with Copilot sub
    openrouter: { inputPer1M: 0.15, cachedInputPer1M: 0.05, outputPer1M: 0.60 }, // Varies by model
    ollama: { inputPer1M: 0, cachedInputPer1M: 0, outputPer1M: 0 },             // Local, free
    mercury: { inputPer1M: 0.25, cachedInputPer1M: 0.025, outputPer1M: 0.75 },
};

// ──────────────────────────────────────────────
// Chat request options
// ──────────────────────────────────────────────

export interface ChatRequestOptions {
    /** Tools to make available for this request */
    tools?: ToolDefinition[];
    /** AbortSignal for cancellation */
    signal?: AbortSignal;
    /** Streaming timeout in ms (0 = none) */
    timeout?: number;
    /** Desired reasoning effort */
    reasoningEffort?: 'instant' | 'low' | 'medium' | 'high';
    /** Temperature override */
    temperature?: number;
    /** Max output tokens override */
    maxTokens?: number;
    /** Model override (e.g. for openrouter model selection) */
    model?: string;
}

// ──────────────────────────────────────────────
// Provider interface
// ──────────────────────────────────────────────

export interface ChatProvider {
    /** Unique identifier for this provider */
    readonly id: ProviderId;

    /** Human-readable name */
    readonly label: string;

    /** What this provider supports */
    readonly capabilities: ProviderCapabilities;

    /** Pricing info */
    readonly pricing: ProviderPricing;

    /**
     * Check if the provider is currently available and configured.
     * Should be cheap (no network call) — checks API key, endpoint, etc.
     */
    isAvailable(): boolean;

    /**
     * Streaming chat completion.
     * @param messages OpenAI-compatible message array
     * @param onToken  Callback for each streamed token
     * @param options  Request options (tools, signal, timeout, etc.)
     * @returns Full result with content, tool calls, and usage
     */
    streamChat(
        messages: import('../mercuryClient').MercuryMessage[],
        onToken: (token: string) => void,
        options?: ChatRequestOptions,
    ): Promise<import('../mercuryClient').StreamResult>;

    /**
     * Non-streaming chat (for quick/simple queries).
     */
    chat(
        messages: import('../mercuryClient').MercuryMessage[],
        options?: ChatRequestOptions,
    ): Promise<{ content: string; usage?: import('../mercuryClient').TokenUsage }>;

    /**
     * Apply-edit (only Mercury supports this natively).
     * Returns undefined if not supported.
     */
    applyEdit?(
        originalCode: string,
        updateSnippet: string,
    ): Promise<{ content: string; usage?: import('../mercuryClient').TokenUsage }>;

    /**
     * Update runtime config (API key, base URL, model, etc.)
     */
    updateConfig(config: Record<string, unknown>): void;
}

// ──────────────────────────────────────────────
// Circuit breaker state (per-provider)
// ──────────────────────────────────────────────

export interface CircuitBreakerState {
    /** Number of consecutive failures */
    failures: number;
    /** Timestamp when the circuit was opened (provider disabled) */
    openedAt?: number;
    /** Half-open probe scheduled at this time */
    halfOpenAt?: number;
}

// ──────────────────────────────────────────────
// Router config
// ──────────────────────────────────────────────

export interface RouterConfig {
    /** Ordered fallback chain: try providers in this order */
    routeOrder: ProviderId[];
    /** Circuit breaker thresholds */
    maxFailures: number;
    /** How long to keep a provider disabled before probing (ms) */
    cooldownMs: number;
}

export const DEFAULT_ROUTE_ORDER: ProviderId[] = ['copilot', 'openrouter', 'ollama', 'mercury'];
export const DEFAULT_MAX_FAILURES = 3;
export const DEFAULT_COOLDOWN_MS = 60_000; // 1 minute

// ──────────────────────────────────────────────
// Error classification
// ──────────────────────────────────────────────

export type ErrorKind = 'rate-limit' | 'auth' | 'timeout' | 'server' | 'network' | 'unsupported' | 'unknown';

export function classifyError(err: unknown): ErrorKind {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('429') || /rate.?limit/i.test(msg)) { return 'rate-limit'; }
    if (msg.includes('401') || msg.includes('403') || /auth|unauthorized|forbidden/i.test(msg)) { return 'auth'; }
    if (msg.includes('408') || /timeout|timed?.?out|stalled/i.test(msg)) { return 'timeout'; }
    if (/5\d{2}/.test(msg) || /server.?error/i.test(msg)) { return 'server'; }
    if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|network/i.test(msg)) { return 'network'; }
    if (/unsupported|not.?supported|not.?available/i.test(msg)) { return 'unsupported'; }
    return 'unknown';
}

/** Errors that should trigger fallback to next provider */
export function isRetryableError(kind: ErrorKind): boolean {
    return kind === 'rate-limit' || kind === 'timeout' || kind === 'server' || kind === 'network';
}
