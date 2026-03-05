/**
 * providers/mercuryProvider.ts — Mercury adapter
 *
 * Wraps the existing MercuryClient to conform to the ChatProvider interface.
 * This is a thin adapter — all real logic stays in mercuryClient.ts.
 */

import { MercuryClient, MercuryMessage, StreamResult, TokenUsage } from '../mercuryClient';
import { annotateCacheControl } from '../promptCache';
import {
    ChatProvider,
    ChatRequestOptions,
    ProviderId,
    ProviderCapabilities,
    ProviderPricing,
    PROVIDER_PRICING,
} from './types';

export class MercuryProvider implements ChatProvider {
    readonly id: ProviderId = 'mercury';
    readonly label = 'Mercury';
    readonly capabilities: ProviderCapabilities = {
        streaming: true,
        toolCalling: true,
        reasoningEffort: true,
        applyEdit: true,
        maxContextTokens: 128_000,
    };
    readonly pricing: ProviderPricing = PROVIDER_PRICING.mercury;

    constructor(private _client: MercuryClient) {}

    /** Expose the underlying client for code that still needs direct access */
    get client(): MercuryClient { return this._client; }

    isAvailable(): boolean {
        // Available if an API key is configured
        return !!(this._client as any).config?.apiKey;
    }

    async streamChat(
        messages: MercuryMessage[],
        onToken: (token: string) => void,
        options?: ChatRequestOptions,
    ): Promise<StreamResult> {
        // Apply per-request overrides
        if (options?.reasoningEffort || options?.temperature || options?.maxTokens || options?.model) {
            this._client.updateConfig({
                ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
                ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
                ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
                ...(options.model ? { model: options.model } : {}),
            });
        }

        return this._client.streamChat(
            annotateCacheControl(messages),
            onToken,
            options?.signal,
            options?.tools,
            options?.timeout,
        );
    }

    async chat(
        messages: MercuryMessage[],
        options?: ChatRequestOptions,
    ): Promise<{ content: string; usage?: TokenUsage }> {
        if (options?.temperature || options?.maxTokens || options?.model) {
            this._client.updateConfig({
                ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
                ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
                ...(options.model ? { model: options.model } : {}),
            });
        }
        return this._client.chat(annotateCacheControl(messages));
    }

    async applyEdit(
        originalCode: string,
        updateSnippet: string,
    ): Promise<{ content: string; usage?: TokenUsage }> {
        return this._client.applyEdit(originalCode, updateSnippet);
    }

    updateConfig(config: Record<string, unknown>): void {
        this._client.updateConfig(config as any);
    }
}
