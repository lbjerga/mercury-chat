/**
 * promptCache.ts — Prompt prefix caching for maximum provider-side cache hits
 *
 * Provider-side prompt caching (Anthropic, OpenAI, OpenRouter) works by
 * matching the token prefix of incoming requests. The longer the identical
 * prefix shared between requests, the more tokens are served from cache
 * (cheaper and faster).
 *
 * This module:
 *  1. Builds a "frozen" system prompt (persona + tools + custom instructions)
 *     that stays byte-identical across all requests within a session.
 *  2. Builds a "context" system prompt (command, workspace tree, language)
 *     that changes per-request but sits AFTER the frozen prefix.
 *  3. Annotates messages with cache_control breakpoints for providers
 *     that support explicit cache hints (Anthropic via OpenRouter, etc.).
 *  4. Provides a shared Rapid Code preamble for cross-phase cache hits.
 */

import { MercuryMessage } from './mercuryClient';
import { getCustomInstructions } from './customInstructions';

// ──────────────────────────────────────────────
// Tool instructions (static, never changes)
// ──────────────────────────────────────────────

export const TOOL_INSTRUCTIONS = `\n\nYou have access to workspace tools (read_file, write_file, edit_file, list_files, search_files, find_symbols, get_diagnostics, open_file, run_command).
When the user asks about their code, use read_file and search_files to understand the codebase before answering.
For multi-step tasks, plan your approach, then execute tools step by step.
Always read files before editing them.
After creating or editing files, use open_file to show them to the user.
Use get_diagnostics to check for errors after making changes.
Use find_symbols to locate function/class definitions quickly.`;

// ──────────────────────────────────────────────
// Frozen system prompt (memoized per session)
// ──────────────────────────────────────────────

let _frozenCache: string | undefined;
let _frozenCustomSnapshot: string | undefined;

/**
 * Build the frozen (stable) portion of the system prompt.
 * Order: persona → tool instructions → custom instructions
 *
 * This is memoized — only recomputed when custom instructions change.
 * The result is byte-identical across all requests in a session,
 * maximizing the provider-side prefix cache hit window.
 */
export function buildFrozenSystemPrompt(basePersona: string): string {
    const custom = getCustomInstructions();

    // Return cached if persona + custom instructions haven't changed
    if (_frozenCache !== undefined && _frozenCustomSnapshot === custom) {
        return _frozenCache;
    }

    let frozen = basePersona;
    frozen += TOOL_INSTRUCTIONS;
    if (custom) {
        frozen += `\n\n${custom}`;
    }

    _frozenCache = frozen;
    _frozenCustomSnapshot = custom;
    return frozen;
}

/**
 * Invalidate the frozen prompt cache.
 * Called when custom instructions file changes.
 */
export function invalidateFrozenPrompt(): void {
    _frozenCache = undefined;
    _frozenCustomSnapshot = undefined;
}

// ──────────────────────────────────────────────
// Context system prompt (volatile, per-request)
// ──────────────────────────────────────────────

/**
 * Build the volatile context portion of the system prompt.
 * This changes per-request but sits AFTER the frozen prefix,
 * so the frozen prefix can still be cached by the provider.
 */
export function buildContextSystemPrompt(
    commandPrompt: string | undefined,
    workspaceTree: string,
    detectedLanguage: string | undefined,
): string {
    const parts: string[] = [];

    if (commandPrompt) {
        parts.push(commandPrompt);
    }

    if (workspaceTree) {
        parts.push(workspaceTree);
    }

    if (detectedLanguage) {
        parts.push(`Detected language: ${detectedLanguage}`);
    }

    return parts.length > 0 ? parts.join('\n\n') : '';
}

// ──────────────────────────────────────────────
// Cache control annotations
// ──────────────────────────────────────────────

/**
 * Annotate messages with cache_control breakpoints.
 *
 * Marks all system-role messages with `cache_control: { type: 'ephemeral' }`
 * for providers that support it (Anthropic via OpenRouter). For providers
 * that ignore this field, the extra property is harmless.
 *
 * With our two-system-message layout:
 *  - messages[0] (frozen prefix) → cache breakpoint 1
 *  - messages[1] (context)       → cache breakpoint 2
 *
 * This gives Anthropic models two breakpoints, maximizing cached token reuse.
 */
export function annotateCacheControl(messages: MercuryMessage[]): MercuryMessage[] {
    return messages.map((m) => {
        if (m.role === 'system') {
            return { ...m, cache_control: { type: 'ephemeral' } };
        }
        return m;
    });
}

// ──────────────────────────────────────────────
// Rapid Code shared preamble
// ──────────────────────────────────────────────

/**
 * Shared preamble for all Rapid Code phases (Plan, Code, Audit).
 * This creates a common cached prefix across phase boundaries —
 * within a single Rapid Code run the provider reuses cached tokens
 * from the preamble for every phase.
 */
export const RC_SYSTEM_PREAMBLE = `You are Mercury 2's autonomous coding agent (Rapid Code). You have access to workspace tools: read_file, write_file, edit_file, list_files, search_files, find_symbols, get_diagnostics, open_file, run_command.
Always read files before editing. Use get_diagnostics after edits. Fix errors immediately.`;

// ──────────────────────────────────────────────
// Sticky model selection
// ──────────────────────────────────────────────

let _stickyModel: string | undefined;
let _stickyTier: string | undefined;

/**
 * Get the sticky model for the current session.
 * Returns the previously selected model if the tier hasn't changed significantly.
 */
export function getStickyModel(currentTier: string, recommendedModel: string | undefined): string | undefined {
    // If tier changed, update the sticky model
    if (_stickyTier !== currentTier) {
        _stickyTier = currentTier;
        _stickyModel = recommendedModel;
        return recommendedModel;
    }

    // Same tier — keep using the sticky model for cache consistency
    return _stickyModel;
}

/** Reset sticky model (e.g., on session clear) */
export function resetStickyModel(): void {
    _stickyModel = undefined;
    _stickyTier = undefined;
}
