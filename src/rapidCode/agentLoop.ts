/**
 * rapidCode/agentLoop.ts — Autonomous agent loop and helpers
 */

import { MercuryClient, MercuryMessage } from '../mercuryClient';
import { TOOL_DEFINITIONS, executeTool } from '../tools';
import { RapidCodeProgress } from '../types';
import { generateId, getWorkspaceRoot } from '../utils';
import { fileCache } from '../fileCache';
import * as vscode from 'vscode';

/** Collect all files that were modified by write_file / edit_file tool calls */
export function trackChangedFiles(toolResults: Array<{ name: string; args: string }>): string[] {
    const changed = new Set<string>();
    for (const r of toolResults) {
        if (r.name === 'write_file' || r.name === 'edit_file') {
            try {
                const args = JSON.parse(r.args);
                if (args.path) { changed.add(args.path); }
            } catch { /* skip */ }
        }
    }
    return [...changed];
}

/** Run the Mercury agent loop autonomously — all tools auto-approved */
export async function runAgentLoop(
    client: MercuryClient,
    messages: MercuryMessage[],
    onProgress: RapidCodeProgress,
    signal?: AbortSignal,
    sharedToolCache?: Map<string, string>
): Promise<{ content: string; toolCalls: Array<{ name: string; args: string }>; totalCalls: number }> {
    const workspaceRoot = getWorkspaceRoot();
    const allToolCalls: Array<{ name: string; args: string }> = [];
    let fullContent = '';
    let totalCalls = 0;
    const MAX_AGENT_ROUNDS = vscode.workspace.getConfiguration('mercuryChat').get<number>('maxAgentRounds', 15);
    let previousRoundChars = 0;

    // #8 Extend fileCache TTL during agent runs (30s instead of 5s)
    fileCache.setTtl(30_000);

    // #7/#12 Request deduplication: reuse shared cache across self-heal iterations
    const toolResultCache = sharedToolCache ?? new Map<string, string>();
    function cacheKey(name: string, args: string): string {
        return name + '::' + args;
    }

    // #10 Token budget per round — cap total tool result chars per round
    const MAX_ROUND_RESULT_CHARS = 24000;

    function compactAssistantToolPrelude(content: string | null | undefined): string | null {
        if (!content) { return null; }
        if (content.length <= 350) { return content; }
        return `${content.slice(0, 220)}\n...(tool prelude compressed)...\n${content.slice(-80)}`;
    }

    // #3 Tool result summarization — truncate large results to save tokens
    function summarizeResult(content: string): string {
        // #8 Skip empty/verbose results — replace with short summary
        if (/no matches found|0 results|directory .* is empty|no diagnostics/i.test(content)) {
            return 'No results.';
        }
        if (content.length > 2048) {
            return content.slice(0, 300) + '\n...(summarized: ' + content.length + ' chars)...\n' + content.slice(-200);
        }
        return content;
    }

    // Token management: trim old tool results to prevent context explosion
    const MAX_MSG_CHARS = 40000; // ~10K tokens budget for conversation history
    function trimMessages(msgs: MercuryMessage[]): MercuryMessage[] {
        let totalChars = 0;
        // Always keep system + user (first 2)
        const kept: MercuryMessage[] = msgs.slice(0, 2);
        for (const m of msgs.slice(0, 2)) {
            totalChars += (typeof m.content === 'string' ? m.content.length : 0);
        }
        // Keep recent messages, trim old tool results
        const rest = msgs.slice(2);
        for (let i = rest.length - 1; i >= 0; i--) {
            const m = rest[i];
            const len = typeof m.content === 'string' ? m.content.length : 0;
            if (totalChars + len > MAX_MSG_CHARS && i < rest.length - 4) {
                // Truncate old tool results to a summary
                if ((m as any).role === 'tool' && len > 500) {
                    rest[i] = { ...m, content: (typeof m.content === 'string' ? m.content.slice(0, 200) : '') + '\n...(truncated — use read_file for full content)' } as any;
                }
            }
            totalChars += typeof rest[i].content === 'string' ? (rest[i].content as string).length : 0;
        }
        return [...kept, ...rest];
    }

    try {
    for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
        if (signal?.aborted) { throw new Error('Cancelled'); }

        onProgress('coding', `Agent round ${round + 1}/${MAX_AGENT_ROUNDS}...`);

        // Trim conversation to prevent token explosion
        const trimmedMessages = round > 2 ? trimMessages(messages) : messages;

        const roundInputChars = trimmedMessages.reduce((sum, m) => {
            return sum + (typeof m.content === 'string' ? m.content.length : 0);
        }, 0);
        const reusedChars = Math.min(previousRoundChars, roundInputChars);
        const reusePct = roundInputChars > 0 ? Math.round((reusedChars / roundInputChars) * 100) : 0;
        onProgress('coding', `Context ${(roundInputChars / 1000).toFixed(1)}k chars (reuse ${reusePct}%)`);
        previousRoundChars = roundInputChars;

        const result = await client.streamChat(
            trimmedMessages,
            (token) => { fullContent += token; },
            signal,
            TOOL_DEFINITIONS
        );

        if (result.toolCalls && result.toolCalls.length > 0) {
            messages.push({
                role: 'assistant',
                content: compactAssistantToolPrelude(result.content),
                tool_calls: result.toolCalls.map(t => ({
                    id: t.id,
                    type: 'function' as const,
                    function: { name: t.function.name, arguments: t.function.arguments },
                })),
            } as any);

            // #10 Parallel tool execution for read-only tools
            const readOnlyTools = new Set(['read_file', 'list_files', 'search_files', 'find_symbols', 'get_diagnostics']);
            const allReadOnly = result.toolCalls.every(tc => readOnlyTools.has(tc.function.name));

            if (allReadOnly && result.toolCalls.length > 1) {
                // Execute all read-only tools in parallel
                const promises = result.toolCalls.map(async (tc) => {
                    totalCalls++;
                    allToolCalls.push({ name: tc.function.name, args: tc.function.arguments });
                    const key = cacheKey(tc.function.name, tc.function.arguments);

                    let argSummary = '';
                    try { const a = JSON.parse(tc.function.arguments); argSummary = a.path || a.command || a.pattern || ''; } catch { /* skip */ }
                    onProgress('coding', `Tool: ${tc.function.name}${argSummary ? ` → ${argSummary}` : ''}`);

                    // #7 Check dedup cache
                    if (toolResultCache.has(key)) {
                        onProgress('coding', `(cached) ${tc.function.name}`);
                        return { tc, content: toolResultCache.get(key)!, id: tc.id };
                    }

                    const toolResult = await executeTool(tc, workspaceRoot);
                    toolResultCache.set(key, toolResult.content);
                    return { tc, content: toolResult.content, id: toolResult.toolCallId || tc.id || generateId() };
                });

                const results = await Promise.all(promises);
                let roundChars = 0;
                for (const r of results) {
                    let content = summarizeResult(r.content);
                    roundChars += content.length;
                    if (roundChars > MAX_ROUND_RESULT_CHARS) {
                        content = content.slice(0, 200) + '\n...(round budget exceeded, truncated)';
                    }
                    messages.push({ role: 'tool', tool_call_id: r.id || generateId(), content } as any);
                }
            } else {
                // Sequential execution (for write operations or single calls)
                for (const tc of result.toolCalls) {
                    totalCalls++;
                    allToolCalls.push({ name: tc.function.name, args: tc.function.arguments });
                    const key = cacheKey(tc.function.name, tc.function.arguments);

                    let argSummary = '';
                    try { const a = JSON.parse(tc.function.arguments); argSummary = a.path || a.command || a.pattern || ''; } catch { /* skip */ }
                    onProgress('coding', `Tool: ${tc.function.name}${argSummary ? ` → ${argSummary}` : ''}`);

                    // #7 Check dedup cache (only for read-only tools)
                    if (readOnlyTools.has(tc.function.name) && toolResultCache.has(key)) {
                        onProgress('coding', `(cached) ${tc.function.name}`);
                        messages.push({ role: 'tool', tool_call_id: tc.id || generateId(), content: toolResultCache.get(key)! } as any);
                        continue;
                    }

                    const toolResult = await executeTool(tc, workspaceRoot);
                    if (readOnlyTools.has(tc.function.name)) { toolResultCache.set(key, toolResult.content); }

                    // #12 fix: invalidate stale read_file cache entries after writes
                    if (tc.function.name === 'write_file' || tc.function.name === 'edit_file') {
                        try {
                            const writtenPath = JSON.parse(tc.function.arguments).path;
                            if (writtenPath) {
                                for (const k of toolResultCache.keys()) {
                                    if (k.startsWith('read_file::') && k.includes(writtenPath)) {
                                        toolResultCache.delete(k);
                                    }
                                }
                            }
                        } catch { /* skip parse errors */ }
                    }

                    const summarized = summarizeResult(toolResult.content);
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolResult.toolCallId || tc.id || generateId(),
                        content: summarized,
                    } as any);
                }
            }

            fullContent = '';
            continue;
        }

        break;
    }

    return { content: fullContent, toolCalls: allToolCalls, totalCalls };
    } finally {
        // #8 Always reset fileCache TTL, even on error/abort
        fileCache.resetTtl();
    }
}
