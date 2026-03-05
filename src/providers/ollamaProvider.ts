/**
 * providers/ollamaProvider.ts — Ollama (local) adapter
 *
 * Ollama exposes an OpenAI-compatible endpoint at http://localhost:11434/v1.
 * Supports streaming. Tool calling support depends on the model.
 * Free — runs on user's hardware.
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
    PROVIDER_PRICING,
} from './types';

// Keep-alive agents
const keepAliveHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 4, timeout: 60_000 });
const keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 4, timeout: 60_000 });

// SSE chunk shape (OpenAI-compatible)
interface StreamChunk {
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

export interface OllamaConfig {
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
    timeout: number;
}

const DEFAULT_OLLAMA_BASE = 'http://localhost:11434/v1';
const DEFAULT_OLLAMA_MODEL = 'llama3.1';

export class OllamaProvider implements ChatProvider {
    readonly id: ProviderId = 'ollama';
    readonly label = 'Ollama (Local)';
    readonly capabilities: ProviderCapabilities = {
        streaming: true,
        toolCalling: true,        // Ollama ≥0.4 supports tool calling for compatible models
        reasoningEffort: false,
        applyEdit: false,
        maxContextTokens: 32_000, // Depends on model; conservative default
    };
    readonly pricing: ProviderPricing = PROVIDER_PRICING.ollama;

    private _config: OllamaConfig;
    /** Cache the last availability probe to avoid hammering localhost */
    private _lastProbe: { available: boolean; at: number } = { available: false, at: 0 };
    private static readonly PROBE_TTL_MS = 60_000; // 60 seconds — Ollama doesn't typically start/stop between requests

    constructor(config?: Partial<OllamaConfig>) {
        this._config = {
            baseUrl: config?.baseUrl ?? DEFAULT_OLLAMA_BASE,
            model: config?.model ?? DEFAULT_OLLAMA_MODEL,
            temperature: config?.temperature ?? 0.6,
            maxTokens: config?.maxTokens ?? 32_768,
            timeout: config?.timeout ?? 120_000,
        };
    }

    isAvailable(): boolean {
        // Cheap check: always assume localhost could be running.
        // Actual connectivity is validated on first use & cached briefly.
        // If never probed, optimistically return true so the router tries.
        const now = Date.now();
        if (now - this._lastProbe.at < OllamaProvider.PROBE_TTL_MS) {
            return this._lastProbe.available;
        }
        return true; // optimistic — real failures handled by circuit breaker
    }

    /** Quick HEAD probe to check if Ollama is actually running */
    async probe(): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const url = new URL(this._config.baseUrl);
            const isHttps = url.protocol === 'https:';
            const transport = isHttps ? https : http;
            const req = transport.request(
                {
                    hostname: url.hostname,
                    port: url.port || (isHttps ? 443 : 80),
                    path: '/api/tags', // Ollama tags endpoint
                    method: 'GET',
                    timeout: 2000,
                },
                (res) => {
                    res.resume(); // drain
                    const ok = res.statusCode !== undefined && res.statusCode < 400;
                    this._lastProbe = { available: ok, at: Date.now() };
                    resolve(ok);
                },
            );
            req.on('error', () => {
                this._lastProbe = { available: false, at: Date.now() };
                resolve(false);
            });
            req.on('timeout', () => {
                req.destroy();
                this._lastProbe = { available: false, at: Date.now() };
                resolve(false);
            });
            req.end();
        });
    }

    async streamChat(
        messages: MercuryMessage[],
        onToken: (token: string) => void,
        options?: ChatRequestOptions,
    ): Promise<StreamResult> {
        const model = options?.model ?? this._config.model;
        const temperature = options?.temperature ?? this._config.temperature;
        const maxTokens = options?.maxTokens ?? this._config.maxTokens;
        const tools = options?.tools;
        const signal = options?.signal;
        const timeout = options?.timeout ?? this._config.timeout;

        const url = new URL(`${this._config.baseUrl}/chat/completions`);

        const requestBody: Record<string, unknown> = {
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: true,
        };

        if (tools && tools.length > 0) {
            requestBody.tools = tools;
            requestBody.tool_choice = 'auto';
        }

        const body = JSON.stringify(requestBody);

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
                    },
                    agent: isHttps ? keepAliveHttpsAgent : keepAliveHttpAgent,
                },
                (res) => {
                    if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                        let errorBody = '';
                        res.on('data', (chunk: Buffer) => (errorBody += chunk.toString()));
                        res.on('end', () => {
                            // Mark as unavailable
                            this._lastProbe = { available: false, at: Date.now() };
                            reject(new Error(`Ollama API error (${res.statusCode}): ${errorBody}`));
                        });
                        return;
                    }

                    // Mark as available on success
                    this._lastProbe = { available: true, at: Date.now() };

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
                                reject(new Error(`Ollama stream stalled — no data for ${Math.round(timeout / 1000)}s`));
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

                                const content = choice.delta?.content;
                                if (content) {
                                    fullContent += content;
                                    onToken(content);
                                }

                                const deltaTools = choice.delta?.tool_calls;
                                if (deltaTools) {
                                    for (const dt of deltaTools) {
                                        const idx = dt.index;
                                        if (!toolCallAccum.has(idx)) {
                                            toolCallAccum.set(idx, { id: dt.id || '', name: dt.function?.name || '', arguments: '' });
                                        }
                                        const acc = toolCallAccum.get(idx)!;
                                        if (dt.id) { acc.id = dt.id; }
                                        if (dt.function?.name) { acc.name = dt.function.name; }
                                        if (dt.function?.arguments) { acc.arguments += dt.function.arguments; }
                                    }
                                }
                            } catch {
                                // skip malformed
                            }
                        }
                    });

                    res.on('end', () => {
                        if (watchdog) { clearTimeout(watchdog); }
                        const toolCalls: ToolCall[] = [];
                        for (const [, acc] of toolCallAccum) {
                            if (acc.id && acc.name) {
                                toolCalls.push({ id: acc.id, function: { name: acc.name, arguments: acc.arguments } });
                            }
                        }
                        resolve({ content: fullContent, toolCalls, usage: lastUsage });
                    });

                    res.on('error', (err) => reject(err));
                },
            );

            if (signal) {
                signal.addEventListener('abort', () => {
                    req.destroy();
                    reject(new Error('Request was cancelled'));
                });
            }

            req.on('error', (err) => {
                this._lastProbe = { available: false, at: Date.now() };
                reject(err);
            });
            req.write(body);
            req.end();
        });
    }

    async chat(
        messages: MercuryMessage[],
        options?: ChatRequestOptions,
    ): Promise<{ content: string; usage?: TokenUsage }> {
        const model = options?.model ?? this._config.model;
        const temperature = options?.temperature ?? this._config.temperature;
        const maxTokens = options?.maxTokens ?? this._config.maxTokens;

        const url = new URL(`${this._config.baseUrl}/chat/completions`);

        const body = JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: false,
        });

        return new Promise<{ content: string; usage?: TokenUsage }>((resolve, reject) => {
            const isHttps = url.protocol === 'https:';
            const transport = isHttps ? https : http;

            const req = transport.request(
                {
                    hostname: url.hostname,
                    port: url.port || (isHttps ? 443 : 80),
                    path: url.pathname + url.search,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    agent: isHttps ? keepAliveHttpsAgent : keepAliveHttpAgent,
                },
                (res) => {
                    let data = '';
                    res.on('data', (chunk) => (data += chunk.toString()));
                    res.on('end', () => {
                        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                            this._lastProbe = { available: false, at: Date.now() };
                            reject(new Error(`Ollama API error (${res.statusCode}): ${data}`));
                            return;
                        }
                        this._lastProbe = { available: true, at: Date.now() };
                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.message?.content || '';
                            const usage = parsed.usage as TokenUsage | undefined;
                            resolve({ content, usage });
                        } catch {
                            reject(new Error(`Failed to parse Ollama response: ${data}`));
                        }
                    });
                    res.on('error', reject);
                },
            );

            req.on('error', (err) => {
                this._lastProbe = { available: false, at: Date.now() };
                reject(err);
            });
            req.write(body);
            req.end();
        });
    }

    updateConfig(config: Record<string, unknown>): void {
        if (config.baseUrl !== undefined) { this._config.baseUrl = String(config.baseUrl); }
        if (config.model !== undefined) { this._config.model = String(config.model); }
        if (config.temperature !== undefined) { this._config.temperature = Number(config.temperature); }
        if (config.maxTokens !== undefined) { this._config.maxTokens = Number(config.maxTokens); }
        if (config.timeout !== undefined) { this._config.timeout = Number(config.timeout); }
    }
}
