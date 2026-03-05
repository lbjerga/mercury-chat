/**
 * providers/baseHttpProvider.ts — Shared HTTP/SSE streaming logic
 *
 * Improvement #13: Extracts the common OpenAI-compatible streaming
 * pattern used by both OllamaProvider and OpenRouterProvider into a
 * reusable base class. Concrete providers only override request
 * construction (URL, headers, auth) and error formatting.
 */

import * as https from 'https';
import * as http from 'http';
import { MercuryMessage, StreamResult, TokenUsage } from '../mercuryClient';
import { ToolCall } from '../types';
import {
    ChatProvider,
    ChatRequestOptions,
    ProviderId,
    ProviderCapabilities,
    ProviderPricing,
} from './types';

// ──────────────────────────────────────────────
// Keep-alive agents (shared across subclasses)
// ──────────────────────────────────────────────

export const sharedHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 4, timeout: 60_000 });
export const sharedHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 4, timeout: 60_000 });

// ──────────────────────────────────────────────
// SSE chunk shape (OpenAI-compatible)
// ──────────────────────────────────────────────

export interface StreamChunk {
    usage?: TokenUsage;
    choices: Array<{
        delta: {
            content?: string | null;
            role?: string;
            tool_calls?: Array<{
                index: number;
                id?: string;
                type?: string;
                function?: { name?: string; arguments?: string };
            }>;
        };
        finish_reason: string | null;
    }>;
}

// ──────────────────────────────────────────────
// Abstract base for HTTP OpenAI-compatible providers
// ──────────────────────────────────────────────

export interface HttpRequestConfig {
    url: URL;
    headers: Record<string, string>;
    body: string;
    timeout: number;
}

export abstract class BaseHttpProvider implements ChatProvider {
    abstract readonly id: ProviderId;
    abstract readonly label: string;
    abstract readonly capabilities: ProviderCapabilities;
    abstract readonly pricing: ProviderPricing;

    abstract isAvailable(): boolean;
    abstract updateConfig(config: Record<string, unknown>): void;

    /**
     * Build the HTTP request configuration for a streaming chat request.
     * Subclasses provide the URL, auth headers, and body shape.
     */
    protected abstract buildStreamRequest(
        messages: MercuryMessage[],
        options?: ChatRequestOptions,
    ): HttpRequestConfig;

    /**
     * Format a provider-specific error message from the HTTP response.
     * Default: "<ProviderLabel> API error (<statusCode>): <body>"
     */
    protected formatHttpError(statusCode: number, body: string): string {
        return `${this.label} API error (${statusCode}): ${body}`;
    }

    /**
     * Hook called on successful HTTP connection. Override in subclasses
     * to update availability probes, etc.
     */
    protected onSuccess(): void { /* noop by default */ }

    /**
     * Hook called on HTTP error. Override to update probes.
     */
    protected onError(): void { /* noop by default */ }

    // ── Streaming chat (shared for all HTTP providers) ──

    async streamChat(
        messages: MercuryMessage[],
        onToken: (token: string) => void,
        options?: ChatRequestOptions,
    ): Promise<StreamResult> {
        const { url, headers, body, timeout } = this.buildStreamRequest(messages, options);
        const signal = options?.signal;

        return new Promise<StreamResult>((resolve, reject) => {
            if (signal?.aborted) {
                reject(new Error('Request was cancelled'));
                return;
            }

            const isHttps = url.protocol === 'https:';
            const transport = isHttps ? https : http;

            const req = transport.request(
                {
                    hostname: url.hostname,
                    port: url.port || (isHttps ? 443 : 80),
                    path: url.pathname + url.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'text/event-stream',
                        ...headers,
                    },
                    agent: isHttps ? sharedHttpsAgent : sharedHttpAgent,
                },
                (res) => {
                    if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                        let errorBody = '';
                        res.on('data', (chunk: Buffer) => (errorBody += chunk.toString()));
                        res.on('end', () => {
                            this.onError();
                            reject(new Error(this.formatHttpError(res.statusCode!, errorBody)));
                        });
                        return;
                    }

                    this.onSuccess();

                    let fullContent = '';
                    let buffer = '';
                    let lastUsage: TokenUsage | undefined;
                    const toolCallAccum: Map<number, { id: string; name: string; arguments: string }> = new Map();

                    let watchdog: NodeJS.Timeout | undefined;
                    const resetWatchdog = () => {
                        if (watchdog) { clearTimeout(watchdog); }
                        if (timeout && timeout > 0) {
                            watchdog = setTimeout(() => {
                                req.destroy();
                                reject(new Error(`${this.label} stream stalled — no data for ${Math.round(timeout / 1000)}s`));
                            }, timeout);
                        }
                    };
                    resetWatchdog();

                    res.on('data', (chunk: Buffer) => {
                        resetWatchdog();
                        buffer += chunk.toString();
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed || !trimmed.startsWith('data: ')) { continue; }
                            const data = trimmed.slice(6);
                            if (data === '[DONE]') { continue; }

                            try {
                                const parsed: StreamChunk = JSON.parse(data);
                                const choice = parsed.choices?.[0];
                                if (!choice) { continue; }

                                if (parsed.usage) { lastUsage = parsed.usage; }

                                // Content tokens
                                const content = choice.delta?.content;
                                if (content) {
                                    fullContent += content;
                                    onToken(content);
                                }

                                // Tool call deltas
                                if (choice.delta?.tool_calls) {
                                    for (const tc of choice.delta.tool_calls) {
                                        const existing = toolCallAccum.get(tc.index);
                                        if (!existing) {
                                            toolCallAccum.set(tc.index, {
                                                id: tc.id || `call_${tc.index}`,
                                                name: tc.function?.name || '',
                                                arguments: tc.function?.arguments || '',
                                            });
                                        } else {
                                            if (tc.function?.arguments) {
                                                existing.arguments += tc.function.arguments;
                                            }
                                        }
                                    }
                                }
                            } catch { /* skip malformed SSE lines */ }
                        }
                    });

                    res.on('end', () => {
                        if (watchdog) { clearTimeout(watchdog); }

                        const toolCalls: ToolCall[] = [];
                        for (const [, tc] of toolCallAccum) {
                            toolCalls.push({
                                id: tc.id,
                                function: { name: tc.name, arguments: tc.arguments },
                            });
                        }

                        resolve({
                            content: fullContent,
                            toolCalls,
                            usage: lastUsage,
                        });
                    });

                    res.on('error', (err) => {
                        if (watchdog) { clearTimeout(watchdog); }
                        reject(new Error(`${this.label} stream error: ${err.message}`));
                    });
                },
            );

            req.on('error', (err) => { reject(new Error(`${this.label} request failed: ${err.message}`)); });
            req.on('timeout', () => { req.destroy(); reject(new Error(`${this.label} connection timeout`)); });

            if (signal) {
                signal.addEventListener('abort', () => { req.destroy(); reject(new Error('Request was cancelled')); }, { once: true });
            }

            req.write(body);
            req.end();
        });
    }

    // ── Non-streaming chat (default implementation via streaming) ──

    async chat(
        messages: MercuryMessage[],
        options?: ChatRequestOptions,
    ): Promise<{ content: string; usage?: TokenUsage }> {
        const result = await this.streamChat(messages, () => {}, options);
        return { content: result.content, usage: result.usage };
    }
}
