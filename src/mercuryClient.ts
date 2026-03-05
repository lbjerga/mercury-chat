import * as https from 'https';
import * as http from 'http';
import { ToolDefinition, ToolCall } from './types';

// #15 Connection keep-alive: reuse HTTP agents to avoid TLS handshake per request
const keepAliveHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 4, timeout: 60000 });
const keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 4, timeout: 60000 });

// ──────────────────────────────────────────────
// Message types (OpenAI-compatible)
// ──────────────────────────────────────────────

export interface MercuryMessageBase {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
}

/** Regular text message */
export interface MercuryTextMessage extends MercuryMessageBase {
    role: 'system' | 'user' | 'assistant';
    content: string;
    /** UI-only metadata (not sent to API) */
    _bookmarked?: boolean;
    _reaction?: string;
}

/** Assistant message that includes tool calls */
export interface MercuryToolCallMessage {
    role: 'assistant';
    content: string | null;
    tool_calls: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
    }>;
}

/** Tool result message */
export interface MercuryToolResultMessage {
    role: 'tool';
    tool_call_id: string;
    content: string;
}

export type MercuryMessage = MercuryTextMessage | MercuryToolCallMessage | MercuryToolResultMessage;

/** Configuration for the Mercury API client. */
export interface MercuryConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
    reasoningEffort?: 'instant' | 'low' | 'medium' | 'high';
}

/** Result of a streaming chat — either text content or tool calls */
export interface TokenUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    reasoning_tokens?: number;
    cached_input_tokens?: number;
}

export interface StreamResult {
    content: string;
    toolCalls: ToolCall[];
    usage?: TokenUsage;
}

// ──────────────────────────────────────────────
// SSE chunk shape (with tool call support)
// ──────────────────────────────────────────────

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
                function?: {
                    name?: string;
                    arguments?: string;
                };
            }>;
        };
        finish_reason: string | null;
    }>;
}

// ──────────────────────────────────────────────
// Mercury API Client
// ──────────────────────────────────────────────

export class MercuryClient {
    private config: MercuryConfig;

    constructor(config: MercuryConfig) {
        this.config = config;
    }

    updateConfig(config: Partial<MercuryConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Streaming chat with tool support.
     * Returns both content and tool_calls — the caller decides what to do.
     */
    async streamChat(
        messages: MercuryMessage[],
        onToken: (token: string) => void,
        signal?: AbortSignal,
        tools?: ToolDefinition[],
        timeout?: number
    ): Promise<StreamResult> {
        const url = new URL(`${this.config.baseUrl}/chat/completions`);

        const requestBody: Record<string, unknown> = {
            model: this.config.model,
            messages,
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens,
            stream: true,
            stream_options: { include_usage: true },
        };

        // Mercury 2 reasoning_effort
        if (this.config.reasoningEffort) {
            requestBody.reasoning_effort = this.config.reasoningEffort;
        }

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
                        'Authorization': `Bearer ${this.config.apiKey}`,
                        'Accept': 'text/event-stream',
                    },
                    agent: isHttps ? keepAliveHttpsAgent : keepAliveHttpAgent, // #15 keep-alive
                },
                (res) => {
                    if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                        let errorBody = '';
                        res.on('data', (chunk: Buffer) => (errorBody += chunk.toString()));
                        res.on('end', () => {
                            let message = `Mercury API error (${res.statusCode})`;
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
                    // Accumulate tool calls by index
                    const toolCallAccum: Map<number, { id: string; name: string; arguments: string }> = new Map();

                    // #30 Streaming timeout watchdog
                    let watchdog: NodeJS.Timeout | undefined;
                    const resetWatchdog = () => {
                        if (watchdog) { clearTimeout(watchdog); }
                        if (timeout && timeout > 0) {
                            watchdog = setTimeout(() => {
                                req.destroy();
                                reject(new Error(`Stream stalled — no data received for ${Math.round(timeout / 1000)}s`));
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

                                // Capture usage (often in final chunk)
                                if (parsed.usage) { lastUsage = parsed.usage; }

                                // Handle text content
                                const content = choice.delta?.content;
                                if (content) {
                                    fullContent += content;
                                    onToken(content);
                                }

                                // Handle tool calls (arguments come in chunks)
                                const deltaTools = choice.delta?.tool_calls;
                                if (deltaTools) {
                                    for (const dt of deltaTools) {
                                        const idx = dt.index;
                                        if (!toolCallAccum.has(idx)) {
                                            toolCallAccum.set(idx, {
                                                id: dt.id || '',
                                                name: dt.function?.name || '',
                                                arguments: '',
                                            });
                                        }
                                        const acc = toolCallAccum.get(idx)!;
                                        if (dt.id) { acc.id = dt.id; }
                                        if (dt.function?.name) { acc.name = dt.function.name; }
                                        if (dt.function?.arguments) { acc.arguments += dt.function.arguments; }
                                    }
                                }
                            } catch {
                                // Skip malformed chunks
                            }
                        }
                    });

                    res.on('end', () => {
                        if (watchdog) { clearTimeout(watchdog); }
                        // Convert accumulated tool calls to ToolCall array
                        const toolCalls: ToolCall[] = [];
                        for (const [, acc] of toolCallAccum) {
                            if (acc.id && acc.name) {
                                toolCalls.push({
                                    id: acc.id,
                                    function: { name: acc.name, arguments: acc.arguments },
                                });
                            }
                        }
                        resolve({ content: fullContent, toolCalls, usage: lastUsage });
                    });

                    res.on('error', (err) => reject(err));
                }
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

    /**
     * Non-streaming chat (for simple queries, no tool support).
     */
    async chat(messages: MercuryMessage[]): Promise<{ content: string; usage?: TokenUsage }> {
        const url = new URL(`${this.config.baseUrl}/chat/completions`);

        const body = JSON.stringify({
            model: this.config.model,
            messages,
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens,
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
                        'Authorization': `Bearer ${this.config.apiKey}`,
                    },
                    agent: isHttps ? keepAliveHttpsAgent : keepAliveHttpAgent, // #15 keep-alive
                },
                (res) => {
                    let data = '';
                    res.on('data', (chunk) => (data += chunk.toString()));
                    res.on('end', () => {
                        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                            reject(new Error(`Mercury API error (${res.statusCode}): ${data}`));
                            return;
                        }
                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.message?.content || '';
                            const usage = parsed.usage as TokenUsage | undefined;
                            resolve({ content, usage });
                        } catch {
                            reject(new Error(`Failed to parse Mercury API response: ${data}`));
                        }
                    });
                    res.on('error', reject);
                }
            );

            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    /**
     * Apply Edit endpoint (Mercury Edit model).
     * Sends original_code + update_snippet → returns the merged result.
     * Uses POST /apply/completions (NOT /chat/completions).
     */
    async applyEdit(originalCode: string, updateSnippet: string): Promise<{ content: string; usage?: TokenUsage }> {
        const url = new URL(`${this.config.baseUrl}/apply/completions`);

        const userContent =
            `<|original_code|>\n${originalCode}\n<|/original_code|>\n\n` +
            `<|update_snippet|>\n${updateSnippet}\n<|/update_snippet|>`;

        const body = JSON.stringify({
            model: this.config.model,   // should be "mercury-edit"
            messages: [
                { role: 'user', content: userContent },
            ],
            max_tokens: this.config.maxTokens,
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
                        'Authorization': `Bearer ${this.config.apiKey}`,
                    },
                    agent: isHttps ? keepAliveHttpsAgent : keepAliveHttpAgent, // #15 keep-alive
                },
                (res) => {
                    let data = '';
                    res.on('data', (chunk) => (data += chunk.toString()));
                    res.on('end', () => {
                        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                            reject(new Error(`Mercury Edit API error (${res.statusCode}): ${data}`));
                            return;
                        }
                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.message?.content
                                         || parsed.choices?.[0]?.text
                                         || '';
                            const usage = parsed.usage as TokenUsage | undefined;
                            resolve({ content, usage });
                        } catch {
                            reject(new Error(`Failed to parse Mercury Edit response: ${data}`));
                        }
                    });
                    res.on('error', reject);
                }
            );

            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }
}
