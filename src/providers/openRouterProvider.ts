/**
 * providers/openRouterProvider.ts — OpenRouter adapter
 *
 * OpenRouter exposes an OpenAI-compatible endpoint at https://openrouter.ai/api/v1.
 * Supports streaming, tool calling (model-dependent), and thousands of models.
 *
 * Pricing varies by model — the default pricing here is a rough average for
 * fast/cheap models. The router picks OpenRouter when Copilot is unavailable.
 */

import * as https from 'https';
import * as http from 'http';
import { MercuryMessage, StreamResult, TokenUsage } from '../mercuryClient';
import { annotateCacheControl } from '../promptCache';
import { ToolDefinition, ToolCall } from '../types';
import {
    ChatProvider,
    ChatRequestOptions,
    ProviderId,
    ProviderCapabilities,
    ProviderPricing,
    PROVIDER_PRICING,
} from './types';

// Keep-alive agents for connection reuse
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

export interface OpenRouterConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
    timeout: number;
}

const DEFAULT_OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.0-flash-001';

export class OpenRouterProvider implements ChatProvider {
    readonly id: ProviderId = 'openrouter';
    readonly label = 'OpenRouter';
    readonly capabilities: ProviderCapabilities = {
        streaming: true,
        toolCalling: true,       // Most modern models support it
        reasoningEffort: false,   // Not an OpenRouter parameter
        applyEdit: false,
        maxContextTokens: 128_000,
    };
    readonly pricing: ProviderPricing = PROVIDER_PRICING.openrouter;

    private _config: OpenRouterConfig;

    constructor(config?: Partial<OpenRouterConfig>) {
        this._config = {
            apiKey: config?.apiKey ?? '',
            baseUrl: config?.baseUrl ?? DEFAULT_OPENROUTER_BASE,
            model: config?.model ?? DEFAULT_OPENROUTER_MODEL,
            temperature: config?.temperature ?? 0.6,
            maxTokens: config?.maxTokens ?? 32_768,
            timeout: config?.timeout ?? 60_000,
        };
    }

    isAvailable(): boolean {
        return !!this._config.apiKey;
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

        /* ═══ Prompt cache: mark ALL system messages for caching ═══ */
        const cachedMessages = annotateCacheControl(messages);

        const requestBody: Record<string, unknown> = {
            model,
            messages: cachedMessages,
            temperature,
            max_tokens: maxTokens,
            stream: true,
            stream_options: { include_usage: true },
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
                        'Authorization': `Bearer ${this._config.apiKey}`,
                        'HTTP-Referer': 'https://github.com/mercury-chat',
                        'X-Title': 'Mercury Chat',
                        'Accept': 'text/event-stream',
                    },
                    agent: isHttps ? keepAliveHttpsAgent : keepAliveHttpAgent,
                },
                (res) => {
                    if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                        let errorBody = '';
                        res.on('data', (chunk: Buffer) => (errorBody += chunk.toString()));
                        res.on('end', () => {
                            let message = `OpenRouter API error (${res.statusCode})`;
                            try {
                                const parsed = JSON.parse(errorBody);
                                message += `: ${parsed.error?.message || parsed.message || JSON.stringify(parsed)}`;
                            } catch {
                                message += `: ${errorBody}`;
                            }
                            reject(new Error(message));
                        });
                        return;
                    }

                    let fullContent = '';
                    let buffer = '';
                    let lastUsage: TokenUsage | undefined;
                    const toolCallAccum: Map<number, { id: string; name: string; arguments: string }> = new Map();

                    // Streaming timeout watchdog
                    let watchdog: NodeJS.Timeout | undefined;
                    const resetWatchdog = () => {
                        if (watchdog) { clearTimeout(watchdog); }
                        if (timeout && timeout > 0) {
                            watchdog = setTimeout(() => {
                                req.destroy();
                                reject(new Error(`OpenRouter stream stalled — no data for ${Math.round(timeout / 1000)}s`));
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

            req.on('error', (err) => reject(err));
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
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this._config.apiKey}`,
                        'HTTP-Referer': 'https://github.com/mercury-chat',
                        'X-Title': 'Mercury Chat',
                    },
                    agent: isHttps ? keepAliveHttpsAgent : keepAliveHttpAgent,
                },
                (res) => {
                    let data = '';
                    res.on('data', (chunk) => (data += chunk.toString()));
                    res.on('end', () => {
                        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                            reject(new Error(`OpenRouter API error (${res.statusCode}): ${data}`));
                            return;
                        }
                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.message?.content || '';
                            const usage = parsed.usage as TokenUsage | undefined;
                            resolve({ content, usage });
                        } catch {
                            reject(new Error(`Failed to parse OpenRouter response: ${data}`));
                        }
                    });
                    res.on('error', reject);
                },
            );

            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    updateConfig(config: Record<string, unknown>): void {
        if (config.apiKey !== undefined) { this._config.apiKey = String(config.apiKey); }
        if (config.baseUrl !== undefined) { this._config.baseUrl = String(config.baseUrl); }
        if (config.model !== undefined) { this._config.model = String(config.model); }
        if (config.temperature !== undefined) { this._config.temperature = Number(config.temperature); }
        if (config.maxTokens !== undefined) { this._config.maxTokens = Number(config.maxTokens); }
        if (config.timeout !== undefined) { this._config.timeout = Number(config.timeout); }
    }
}
