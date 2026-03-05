/**
 * contextBudget.ts — Context window budget allocator
 *
 * Before sending messages to a provider, this module trims the
 * conversation to fit within the provider's context window. Strategy:
 *
 *  1. Always keep the system prompt (first message).
 *  2. Always keep the last N user/assistant exchanges.
 *  3. Drop oldest middle messages to fit budget.
 *  4. If a single message exceeds budget, truncate its content.
 *
 * Token estimation: ~4 characters per token (conservative).
 */

import { MercuryMessage } from './mercuryClient';

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const CHARS_PER_TOKEN = 4;
/** Reserve tokens for the model's response */
const OUTPUT_RESERVE = 4096;
/** Minimum messages to always keep (system + last exchange) */
const MIN_KEEP = 3;

// ──────────────────────────────────────────────
// Token estimation (memoized by content length to avoid recomputation)
// ──────────────────────────────────────────────

/** WeakMap-based memoization for message token estimates */
const _tokenEstimateCache = new WeakMap<MercuryMessage, number>();

/** Estimate token count for a single message (memoized) */
export function estimateMessageTokens(msg: MercuryMessage): number {
    const cached = _tokenEstimateCache.get(msg);
    if (cached !== undefined) { return cached; }

    let chars = 0;
    if (typeof msg.content === 'string') {
        chars += msg.content.length;
    }
    // Tool call arguments count toward tokens
    if ('tool_calls' in msg && Array.isArray((msg as any).tool_calls)) {
        for (const tc of (msg as any).tool_calls) {
            chars += (tc.function?.name?.length || 0) + (tc.function?.arguments?.length || 0);
        }
    }
    // Role + overhead (~4 tokens per message for role/separator)
    const result = Math.ceil(chars / CHARS_PER_TOKEN) + 4;
    _tokenEstimateCache.set(msg, result);
    return result;
}

/** Estimate total tokens for a message array */
export function estimateTotalTokens(messages: MercuryMessage[]): number {
    return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

// ──────────────────────────────────────────────
// Budget trimming
// ──────────────────────────────────────────────

export interface BudgetOptions {
    /** Max context tokens for the target provider (0 = unlimited) */
    maxContextTokens: number;
    /** Tokens to reserve for output (default: 4096) */
    outputReserve?: number;
    /** Minimum trailing messages to always keep (default: 3) */
    minKeep?: number;
}

/**
 * Trim messages to fit within the provider's context budget.
 * Returns a new array — does not mutate the input.
 *
 * Strategy:
 *  - Keep messages[0] if it's a system prompt.
 *  - Keep the last `minKeep` messages.
 *  - Drop middle messages oldest-first until under budget.
 */
export function trimToContextBudget(
    messages: MercuryMessage[],
    options: BudgetOptions,
): MercuryMessage[] {
    const maxCtx = options.maxContextTokens;
    if (maxCtx <= 0) { return messages; } // unlimited

    const outputReserve = options.outputReserve ?? OUTPUT_RESERVE;
    const minKeep = options.minKeep ?? MIN_KEEP;
    const budget = maxCtx - outputReserve;

    if (budget <= 0) { return messages.slice(-minKeep); }

    // Already fits?
    const currentTokens = estimateTotalTokens(messages);
    if (currentTokens <= budget) { return messages; }

    // Partition: system prompt(s) | middle | tail
    // Protect ALL leading system messages (frozen prefix + context prefix)
    // so the provider-side cache prefix is never trimmed away.
    let systemCount = 0;
    while (systemCount < messages.length && messages[systemCount].role === 'system') {
        systemCount++;
    }
    const systemMsgs = messages.slice(0, systemCount);
    const keepTail = Math.max(minKeep, 2);
    const tailStart = Math.max(systemCount, messages.length - keepTail);
    const tail = messages.slice(tailStart);
    const middle = messages.slice(systemCount, tailStart);

    // Calculate fixed token cost (system + tail)
    const fixedTokens = estimateTotalTokens(systemMsgs) + estimateTotalTokens(tail);

    if (fixedTokens >= budget) {
        // Even system + tail exceeds budget — just keep tail and truncate if needed
        const trimmedTail = _truncateLargeMessages(tail, budget);
        return [...systemMsgs, ...trimmedTail];
    }

    // Fill middle messages from newest to oldest until budget exhausted
    const remainingBudget = budget - fixedTokens;
    const keptMiddle: MercuryMessage[] = [];
    let usedTokens = 0;

    for (let i = middle.length - 1; i >= 0; i--) {
        const msgTokens = estimateMessageTokens(middle[i]);
        if (usedTokens + msgTokens > remainingBudget) { break; }
        keptMiddle.unshift(middle[i]);
        usedTokens += msgTokens;
    }

    return [...systemMsgs, ...keptMiddle, ...tail];
}

/**
 * Truncate individual messages that are too large.
 * Used as a last resort when even the tail exceeds budget.
 */
function _truncateLargeMessages(messages: MercuryMessage[], budget: number): MercuryMessage[] {
    const result: MercuryMessage[] = [];
    let used = 0;

    for (const msg of messages) {
        const tokens = estimateMessageTokens(msg);
        if (used + tokens <= budget) {
            result.push(msg);
            used += tokens;
        } else {
            // Truncate this message's content to fit
            const available = Math.max(0, budget - used - 4) * CHARS_PER_TOKEN;
            if (available > 0 && typeof msg.content === 'string') {
                result.push({ ...msg, content: msg.content.slice(0, available) + '\n[...truncated]' });
                used = budget;
            }
            break;
        }
    }

    return result;
}
