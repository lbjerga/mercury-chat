/**
 * providers/copilotProvider.ts — VS Code Copilot Language Model adapter
 *
 * Uses the `vscode.lm.selectChatModels()` API to access Copilot models
 * (GPT-4o, GPT-5 mini, etc.) at zero cost when a Copilot subscription
 * is active. This is the preferred provider — 0 credits, very fast.
 *
 * Limitations:
 *  - No tool/function calling (Copilot LM API doesn't expose it)
 *  - No reasoning_effort parameter
 *  - Subject to Copilot rate limits (undocumented)
 *  - Only available when the GitHub Copilot extension is installed
 */

import * as vscode from 'vscode';
import { MercuryMessage, StreamResult, TokenUsage } from '../mercuryClient';
import {
    ChatProvider,
    ChatRequestOptions,
    ProviderId,
    ProviderCapabilities,
    ProviderPricing,
    PROVIDER_PRICING,
} from './types';

export class CopilotProvider implements ChatProvider {
    readonly id: ProviderId = 'copilot';
    readonly label = 'Copilot';
    readonly capabilities: ProviderCapabilities = {
        streaming: true,
        toolCalling: false,       // Copilot LM API does not expose tool calling
        reasoningEffort: false,
        applyEdit: false,
        maxContextTokens: 128_000,
    };
    readonly pricing: ProviderPricing = PROVIDER_PRICING.copilot;

    private _preferredFamily: string;
    private _cachedModel: vscode.LanguageModelChat | undefined;
    private _cacheExpiry = 0;
    private static readonly CACHE_TTL_MS = 300_000; // 5 minutes — available models change rarely

    constructor(preferredFamily?: string) {
        this._preferredFamily = preferredFamily ?? 'gpt-4o';
    }

    isAvailable(): boolean {
        // Check if the Copilot LM API exists (extension installed)
        return typeof vscode.lm?.selectChatModels === 'function';
    }

    /** Select the best available Copilot model */
    private async _selectModel(): Promise<vscode.LanguageModelChat | undefined> {
        const now = Date.now();
        if (this._cachedModel && now < this._cacheExpiry) {
            return this._cachedModel;
        }

        try {
            // Try preferred family first
            let models = await vscode.lm.selectChatModels({ family: this._preferredFamily });
            if (!models || models.length === 0) {
                // Fallback: any available model
                models = await vscode.lm.selectChatModels();
            }
            if (models && models.length > 0) {
                this._cachedModel = models[0];
                this._cacheExpiry = now + CopilotProvider.CACHE_TTL_MS;
                return this._cachedModel;
            }
        } catch {
            // selectChatModels can throw if Copilot is not ready
        }
        this._cachedModel = undefined;
        return undefined;
    }

    async streamChat(
        messages: MercuryMessage[],
        onToken: (token: string) => void,
        options?: ChatRequestOptions,
    ): Promise<StreamResult> {
        const model = await this._selectModel();
        if (!model) {
            throw new Error('No Copilot language model available');
        }

        // Convert MercuryMessage[] → vscode.LanguageModelChatMessage[]
        const vsMessages = this._convertMessages(messages);

        const cancellation = new vscode.CancellationTokenSource();
        if (options?.signal) {
            options.signal.addEventListener('abort', () => cancellation.cancel());
        }

        const response = await model.sendRequest(
            vsMessages,
            {},
            cancellation.token,
        );

        let fullContent = '';
        for await (const part of response.text) {
            fullContent += part;
            onToken(part);
        }

        // Copilot LM API doesn't report token usage — estimate
        const estimatedInput = Math.ceil(messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0) / 4);
        const estimatedOutput = Math.ceil(fullContent.length / 4);
        const usage: TokenUsage = {
            prompt_tokens: estimatedInput,
            completion_tokens: estimatedOutput,
            total_tokens: estimatedInput + estimatedOutput,
        };

        return {
            content: fullContent,
            toolCalls: [], // Copilot LM API doesn't support tool calls
            usage,
        };
    }

    async chat(
        messages: MercuryMessage[],
        options?: ChatRequestOptions,
    ): Promise<{ content: string; usage?: TokenUsage }> {
        // Reuse streamChat but collect all tokens
        let content = '';
        const result = await this.streamChat(messages, (t) => { content += t; }, options);
        return { content: result.content, usage: result.usage };
    }

    updateConfig(config: Record<string, unknown>): void {
        if (config.preferredFamily !== undefined) {
            this._preferredFamily = String(config.preferredFamily);
            this._cachedModel = undefined; // invalidate cache
            this._cacheExpiry = 0;
        }
    }

    /** Convert Mercury messages to vscode.LanguageModelChatMessage */
    private _convertMessages(messages: MercuryMessage[]): vscode.LanguageModelChatMessage[] {
        const result: vscode.LanguageModelChatMessage[] = [];

        for (const msg of messages) {
            const content = typeof msg.content === 'string' ? msg.content : '';
            if (!content) { continue; } // Skip empty / tool-result messages

            switch (msg.role) {
                case 'system':
                    // Copilot treats system as User with a prefix
                    result.push(vscode.LanguageModelChatMessage.User(`[System] ${content}`));
                    break;
                case 'user':
                    result.push(vscode.LanguageModelChatMessage.User(content));
                    break;
                case 'assistant':
                    result.push(vscode.LanguageModelChatMessage.Assistant(content));
                    break;
                case 'tool':
                    // Flatten tool results into user messages
                    result.push(vscode.LanguageModelChatMessage.User(`[Tool Result] ${content}`));
                    break;
            }
        }

        return result;
    }
}
