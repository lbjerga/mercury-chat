/**
 * contextTrimmer.ts — Token estimation, message trimming, dropped-message summarization
 * Extracted from chatViewProvider.ts
 *
 * Improvement #7: estimateTokens results are memoized via a small LRU cache
 * keyed by string hash, so repeated estimation on the same content (common
 * when the conversation hasn't changed) avoids redundant work.
 */

import { MercuryMessage, MercuryToolCallMessage } from '../mercuryClient';
import { ProviderRouter } from '../providers';

// ── Token estimation cache (#7) ──
const TOKEN_CACHE_MAX = 256;
const _tokenCache = new Map<number, number>();

/** djb2 hash — cheap, collision-tolerant for cache purposes */
function _hash(s: string): number {
    let h = 5381;
    for (let i = 0, len = s.length; i < len; i++) {
        h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return h;
}

/** Rough estimate: ~4 chars per token for English/code (memoized) */
export function estimateTokens(text: string): number {
    const h = _hash(text);
    const cached = _tokenCache.get(h);
    if (cached !== undefined) { return cached; }
    const tokens = Math.ceil(text.length / 4);
    if (_tokenCache.size >= TOKEN_CACHE_MAX) {
        // evict oldest
        const first = _tokenCache.keys().next().value;
        if (first !== undefined) { _tokenCache.delete(first); }
    }
    _tokenCache.set(h, tokens);
    return tokens;
}

/** Clear the token estimation cache (for tests) */
export function clearTokenCache(): void {
    _tokenCache.clear();
}

export async function trimMessagesToTokenLimit(
    messages: MercuryMessage[],
    maxTokens: number,
    router: ProviderRouter | undefined,
): Promise<MercuryMessage[]> {
    if (messages.length <= 2) { return messages; }
    const system = messages[0];
    const rest = messages.slice(1);

    // Prompt compression: strip redundant whitespace
    const compressed = rest.map(msg => {
        if (!msg.content || msg.role === 'system') { return msg; }
        if (msg.role === 'tool') {
            let c = msg.content;
            c = c.replace(/\n{3,}/g, '\n\n');
            c = c.replace(/^[ \t]+$/gm, '');
            c = c.replace(/ {4,}/g, '  ');
            if (c.length > 4000) { c = c.slice(0, 3800) + '\n...(truncated)'; }
            return { ...msg, content: c };
        }
        return msg;
    });

    let totalTokens = estimateTokens(system.content || '');
    const kept: MercuryMessage[] = [];

    for (let i = compressed.length - 1; i >= 0; i--) {
        const msg = compressed[i];
        const msgContent = msg.content || '';
        let msgTokens: number;
        if ('tool_calls' in msg) {
            msgTokens = estimateTokens(JSON.stringify((msg as MercuryToolCallMessage).tool_calls));
        } else {
            msgTokens = estimateTokens(msgContent);
        }

        if (totalTokens + msgTokens > maxTokens) {
            const droppedCount = i + 1;
            if (droppedCount > 2) {
                const dropped = compressed.slice(0, i + 1);
                const summaryText = await summarizeDroppedMessages(dropped, droppedCount, router);
                const summaryMsg: MercuryMessage = {
                    role: 'system',
                    content: summaryText,
                };
                kept.unshift(summaryMsg);
            }
            break;
        }
        totalTokens += msgTokens;
        kept.unshift(msg);
    }

    return [system, ...kept];
}

/** Summarize dropped messages using the router (or fall back to a static placeholder) */
async function summarizeDroppedMessages(
    dropped: MercuryMessage[],
    count: number,
    router: ProviderRouter | undefined,
): Promise<string> {
    const droppedText = dropped
        .filter(m => m.content)
        .map(m => `${m.role}: ${(m.content || '').slice(0, 300)}`)
        .join('\n');

    if (router && droppedText.length > 200) {
        try {
            const summaryPrompt: MercuryMessage[] = [
                { role: 'system', content: 'Summarize the following conversation excerpt in 2-3 sentences. Focus on: what the user asked, what actions were taken, and any key decisions or results. Be concise.' },
                { role: 'user', content: droppedText.slice(0, 3000) },
            ];
            const response = await router.chat(summaryPrompt);
            if (response && response.content && response.content.length > 10) {
                return `[Summary of ${count} earlier messages: ${response.content.trim()}]`;
            }
        } catch {
            // Fall through to static placeholder
        }
    }

    return `[${count} earlier messages were pruned to save context. The conversation started with the user's original question and the assistant provided responses with ${count > 4 ? 'multiple tool calls and ' : ''}intermediate steps.]`;
}
