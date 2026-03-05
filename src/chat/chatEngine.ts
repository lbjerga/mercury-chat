/**
 * chatEngine.ts — Core chat logic with tool call loop, smart retry, learnings
 * Extracted from chatViewProvider.ts _handleUserMessage (~415 lines)
 */

import * as vscode from 'vscode';
import { MercuryMessage, MercuryToolCallMessage, MercuryToolResultMessage, TokenUsage } from '../mercuryClient';
import { TOOL_DEFINITIONS, executeTool, READ_ONLY_TOOLS } from '../tools';
import { ChatViewContext, postMessage, beginStreamingUi, endStreamingUi, enforceSessionMessageLimit, flushStreamBatch } from '../chatViewContext';
import { tokenTracker } from '../tokenTracker';
import { autoDetectEffort } from '../autoReasoning';
import { learningsManager } from '../learnings';
import { selectModel } from '../modelSelector';
import { expandFileReferences } from './fileReferenceExpander';
import { getWorkspaceTree } from './workspaceTree';
import { estimateTokens, trimMessagesToTokenLimit } from './contextTrimmer';
import { confirmTool } from './toolConfirmation';
import { generateFollowUps } from './followUps';
import { renameSession } from '../session/sessionManager';

const DEFAULT_MAX_TOOL_ROUNDS = 15;
const STREAM_BATCH_INTERVAL = 16; // ~60fps

export async function handleUserMessage(ctx: ChatViewContext, text: string, mode?: string): Promise<void> {
    if (!ctx.view || !ctx.currentSession) { return; }

    // Request deduplication: reject sends within 500ms of last
    const now = Date.now();
    if (now - ctx.lastSendTimestamp < 500) { return; }
    ctx.lastSendTimestamp = now;

    // Store for retry
    ctx.lastUserText = text;
    ctx.lastUserMode = mode;

    const config = vscode.workspace.getConfiguration('mercuryChat');
    const apiKey = config.get<string>('apiKey', '');

    // Check if ANY provider is available (not just Mercury)
    const hasAnyProvider = ctx.router
        ? !!ctx.router.selectProvider()
        : !!apiKey;

    if (!hasAnyProvider) {
        postMessage(ctx, {
            type: 'addMessage', role: 'assistant',
            content: '\u26a0\ufe0f **No provider available.** Configure at least one provider in Settings:\n\n' +
                '• **Copilot** — install GitHub Copilot extension and sign in\n' +
                '• **OpenRouter** — set `mercuryChat.openRouterApiKey`\n' +
                '• **Ollama** — run `ollama serve` locally\n' +
                '• **Mercury** — set `mercuryChat.apiKey`\n\n' +
                'Then adjust `mercuryChat.routeOrder` to set fallback priority.',
        });
        return;
    }

    // Update Mercury client config (used as fallback even if key is empty)
    ctx.client.updateConfig({
        apiKey,
        baseUrl: config.get<string>('apiBaseUrl', 'https://api.inceptionlabs.ai/v1'),
        model: config.get<string>('model', 'mercury-2'),
        temperature: config.get<number>('temperature', 0.6),
        maxTokens: config.get<number>('maxTokens', 32768),
        reasoningEffort: config.get<string>('reasoningEffort', 'medium') as 'instant' | 'low' | 'medium' | 'high',
    });

    // Expand @file references
    let expandedText = await expandFileReferences(text);

    // Auto-inject active file context
    if (ctx.activeFileContext) {
        const afc = ctx.activeFileContext;
        let contextBlock = `\n\n[Active file: ${afc.path} (${afc.language}, ${afc.lineCount} lines)]`;
        if (afc.selection) {
            contextBlock += `\n[Selection lines ${afc.selection.startLine}-${afc.selection.endLine}]:\n\`\`\`${afc.language}\n${afc.selection.text}\n\`\`\``;
        }
        const performanceMode = config.get<boolean>('performanceMode', false);
        if (!performanceMode && afc.diagnostics && afc.diagnostics.length > 0) {
            contextBlock += '\n[Diagnostics]:';
            for (const d of afc.diagnostics) {
                contextBlock += `\n- Line ${d.line}: ${d.severity}: ${d.message}`;
            }
        }
        expandedText += contextBlock;
    }

    // Add user message & show it
    ctx.currentSession.messages.push({ role: 'user', content: expandedText });
    enforceSessionMessageLimit(ctx);
    postMessage(ctx, { type: 'addMessage', role: 'user', content: text });

    // Auto-title from first user message
    if (ctx.currentSession.messages.filter(m => m.role === 'user').length === 1
        && ctx.currentSession.title.startsWith('Chat ')) {
        const cleanText = text.replace(/^\[MODE: \w+\]\s*/, '');
        const autoTitle = cleanText.length > 50 ? cleanText.slice(0, 47) + '...' : cleanText;
        renameSession(ctx, ctx.currentSession.id, autoTitle);
    }

    // Build system prompt (cache-aware: stable prefix first, dynamic suffix last)
    const basePrompt = ctx.currentSession.systemPrompt
        || config.get<string>('systemPrompt', 'You are Mercury 2, an expert coding assistant by Inception.');

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const toolMentions = /\b(file|edit|write|create|read|run|search|command|build|test|fix|implement|add|change|modify|refactor)\b/i.test(text);
    const enableTools = config.get<boolean>('enableTools', true) && !!workspaceRoot && (mode === 'code' || toolMentions);

    let stablePrefix = basePrompt;
    if (enableTools) {
        stablePrefix += '\n\nUse the provided tools when needed. Always read files before editing them.';
    }

    const performanceMode = config.get<boolean>('performanceMode', false);
    if (!performanceMode && config.get<boolean>('autoInjectWorkspace', true) && workspaceRoot) {
        const tree = getWorkspaceTree(ctx);
        if (tree) {
            stablePrefix += '\n\nWorkspace file tree:\n```\n' + tree + '\n```';
        }
    }

    const errContext = learningsManager.getFrequentErrors(3);
    if (errContext) { stablePrefix += '\n\n' + errContext; }

    let dynamicSuffix = '';
    const MODE_SYSTEM: Record<string, string> = {
        plan: '\n\n[Current mode: PLAN] Think step-by-step. Outline an architecture or plan before writing code. Ask clarifying questions if needed. Do NOT write code unless the user explicitly asks.',
        code: '\n\n[Current mode: CODE] You MUST use tools to create, read, and edit files. NEVER show code in chat — call the appropriate tool. To create files: write_file. To modify: read_file first, then edit_file with exact oldString/newString. Be concise. Do NOT embed code blocks as a substitute for tool calls.',
    };
    if (mode && MODE_SYSTEM[mode]) { dynamicSuffix += MODE_SYSTEM[mode]; }

    const systemPrompt = stablePrefix + dynamicSuffix;

    // Token sliding window
    const maxContextTokens = config.get<number>('maxContextTokens', 16000);

    // Budget guardrail with adaptive degradation
    const maxSessionCost = config.get<number>('maxSessionCostUsd', 1.0);
    if (tokenTracker.isOverBudget(maxSessionCost)) {
        postMessage(ctx, {
            type: 'addMessage', role: 'assistant',
            content: `\u26a0\ufe0f **Budget limit reached.** ${tokenTracker.getBudgetWarning(maxSessionCost)}\n\nRun **Mercury: Reset Token Stats** or increase \`mercuryChat.maxSessionCostUsd\` in settings.`,
        });
        return;
    }

    const costRatio = maxSessionCost > 0 ? tokenTracker.getSessionCost() / maxSessionCost : 0;
    if (costRatio > 0.8) {
        ctx.client.updateConfig({ maxTokens: Math.min(config.get<number>('maxTokens', 32768), 8192) });
        if (costRatio > 0.9) {
            ctx.client.updateConfig({ reasoningEffort: 'low' });
        }
    }

    // Auto-reasoning
    const autoReasoning = config.get<boolean>('autoReasoningEffort', true) && !performanceMode;
    if (autoReasoning) {
        const signals = {
            prompt: text,
            command: mode,
            referenceCount: 0,
            referenceSize: 0,
            historyTurns: ctx.currentSession.messages.filter(m => m.role === 'user').length,
            hasErrors: !!(ctx.activeFileContext?.diagnostics?.length),
            workspaceFileCount: 0,
            isFollowUp: ctx.currentSession.messages.filter(m => m.role === 'user').length > 1,
        };
        const { effort } = autoDetectEffort(signals);
        ctx.client.updateConfig({ reasoningEffort: effort });
    }

    ctx.streamStartTime = Date.now();
    beginStreamingUi(ctx);
    ctx.abortController = new AbortController();
    let lastUsage: TokenUsage | undefined;

    // G2 fix: smart model selection
    if (ctx.router) {
        const contextEst = estimateTokens(stablePrefix) + ctx.currentSession.messages.reduce((n, m) => n + estimateTokens(m.content || ''), 0);
        const modelRec = selectModel(text, contextEst);
        if (modelRec.openRouterModel) {
            const orProv = ctx.router.getProvider('openrouter');
            if (orProv) { orProv.updateConfig({ model: modelRec.openRouterModel }); }
        }
        ctx.client.updateConfig({ reasoningEffort: modelRec.mercuryEffort });
    }

    try {
        const maxToolRounds = vscode.workspace.getConfiguration('mercuryChat').get<number>('maxAgentRounds', DEFAULT_MAX_TOOL_ROUNDS);
        for (let round = 0; round < maxToolRounds; round++) {
            let messages: MercuryMessage[] = [
                { role: 'system', content: systemPrompt },
                ...ctx.currentSession.messages,
            ];

            messages = await trimMessagesToTokenLimit(messages, maxContextTokens, ctx.router);

            const onToken = (token: string) => {
                ctx.streamBatchBuffer += token;
                if (!ctx.streamBatchTimer) {
                    ctx.streamBatchTimer = setTimeout(() => {
                        flushStreamBatch(ctx);
                    }, STREAM_BATCH_INTERVAL);
                }
            };

            let result;
            const maxRetries = 3;
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    result = await (ctx.router
                        ? ctx.router.streamChat(messages, onToken, {
                            signal: ctx.abortController.signal,
                            tools: enableTools ? TOOL_DEFINITIONS : undefined,
                        })
                        : ctx.client.streamChat(
                            messages, onToken, ctx.abortController.signal,
                            enableTools ? TOOL_DEFINITIONS : undefined
                        ));
                    break; // Success
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    const isRetryable = /429|5\d{2}|stalled|timeout|ECONNREFUSED/i.test(msg);
                    if (!isRetryable || attempt >= maxRetries - 1) { throw err; }
                    const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
                    postMessage(ctx, {
                        type: 'toolAction', name: 'retry',
                        args: `Attempt ${attempt + 2}/${maxRetries} in ${delay / 1000}s`,
                        status: 'running',
                    });
                    await new Promise(r => setTimeout(r, delay));
                }
            }
            if (!result) { throw new Error('All retry attempts failed'); }

            flushStreamBatch(ctx);

            if (result.usage) { lastUsage = result.usage; }

            // Handle tool calls
            if (result.toolCalls.length > 0) {
                const toolCallMsg: MercuryToolCallMessage = {
                    role: 'assistant',
                    content: result.content || null,
                    tool_calls: result.toolCalls.map(tc => ({
                        id: tc.id,
                        type: 'function' as const,
                        function: { name: tc.function.name, arguments: tc.function.arguments },
                    })),
                };
                ctx.currentSession.messages.push(toolCallMsg);
                enforceSessionMessageLimit(ctx);

                // Dedup
                const seenToolKeys = new Set<string>();
                const dedupedToolCalls = result.toolCalls.filter(tc => {
                    const key = tc.function.name + '::' + tc.function.arguments;
                    if (seenToolKeys.has(key)) { return false; }
                    seenToolKeys.add(key);
                    return true;
                });

                // Parallel read-only, sequential write
                const readOnlyCalls = dedupedToolCalls.filter(tc => READ_ONLY_TOOLS.has(tc.function.name));
                const writeCalls = dedupedToolCalls.filter(tc => !READ_ONLY_TOOLS.has(tc.function.name));

                if (readOnlyCalls.length > 0) {
                    postMessage(ctx, {
                        type: 'toolActions',
                        items: readOnlyCalls.map(tc => ({
                            name: tc.function.name, args: tc.function.arguments, status: 'running',
                        })),
                    });
                    const readResults = await Promise.all(
                        readOnlyCalls.map(tc => executeTool(tc, workspaceRoot, ctx.router))
                    );
                    for (let i = 0; i < readOnlyCalls.length; i++) {
                        const toolResultMsg: MercuryToolResultMessage = {
                            role: 'tool', tool_call_id: readResults[i].toolCallId,
                            content: readResults[i].content,
                        };
                        ctx.currentSession.messages.push(toolResultMsg);
                        enforceSessionMessageLimit(ctx);
                    }
                    postMessage(ctx, {
                        type: 'toolActions',
                        items: readOnlyCalls.map((tc, i) => ({
                            name: tc.function.name, args: tc.function.arguments,
                            status: readResults[i].isError ? 'error' : 'done',
                            result: readResults[i].content.length > 500
                                ? readResults[i].content.slice(0, 500) + '...'
                                : readResults[i].content,
                        })),
                    });
                }

                for (const toolCall of writeCalls) {
                    postMessage(ctx, {
                        type: 'toolAction', name: toolCall.function.name,
                        args: toolCall.function.arguments, status: 'running',
                    });

                    const approved = await confirmTool(ctx, toolCall.function.name, toolCall.function.arguments);
                    if (!approved) {
                        postMessage(ctx, {
                            type: 'toolAction', name: toolCall.function.name,
                            args: toolCall.function.arguments, status: 'error', result: 'Skipped by user',
                        });
                        const toolResultMsg: MercuryToolResultMessage = {
                            role: 'tool', tool_call_id: toolCall.id,
                            content: 'Tool execution was denied by the user.',
                        };
                        ctx.currentSession.messages.push(toolResultMsg);
                        enforceSessionMessageLimit(ctx);
                        continue;
                    }

                    const toolResult = await executeTool(toolCall, workspaceRoot, ctx.router);
                    postMessage(ctx, {
                        type: 'toolAction', name: toolCall.function.name,
                        args: toolCall.function.arguments,
                        status: toolResult.isError ? 'error' : 'done',
                        result: toolResult.content.length > 500
                            ? toolResult.content.slice(0, 500) + '...'
                            : toolResult.content,
                    });

                    const toolResultMsg: MercuryToolResultMessage = {
                        role: 'tool', tool_call_id: toolResult.toolCallId,
                        content: toolResult.content,
                    };
                    ctx.currentSession.messages.push(toolResultMsg);
                    enforceSessionMessageLimit(ctx);
                }
                continue;
            }

            // No tool calls — final text response
            if (result.content) {
                const content = result.content;
                const isCodeMode = mode === 'code';
                const isTooShort = isCodeMode && content.length < 80 && !content.includes('```');
                const isRefusal = /\b(I cannot|I'm unable|I can't|I don't have access|not able to)\b/i.test(content);
                const isApology = content.length < 200 && /\b(sorry|apologi[sz]e)\b/i.test(content) && !/```/.test(content);

                if ((isTooShort || isRefusal || isApology) && ctx.router && round === 0) {
                    postMessage(ctx, {
                        type: 'toolAction', name: 'smart_retry',
                        args: isRefusal ? 'refusal detected' : isTooShort ? 'response too short' : 'apology without content',
                        status: 'running',
                    });
                    const weakProvider = ctx.router.lastUsedProvider;
                    if (weakProvider) { ctx.router.softTrip(weakProvider); }
                    continue;
                }

                ctx.currentSession.messages.push({ role: 'assistant', content });
                enforceSessionMessageLimit(ctx);
            }
            break;
        }

        ctx.currentSession.updatedAt = Date.now();
        ctx.storage.saveSession(ctx.currentSession);

        const entry = ctx.index.sessions.find(s => s.id === ctx.currentSession!.id);
        if (entry) { entry.updatedAt = ctx.currentSession.updatedAt; }
        ctx.storage.saveIndex(ctx.index);

        const responseTime = ctx.streamStartTime ? ((Date.now() - ctx.streamStartTime) / 1000).toFixed(1) : undefined;

        const durationMs = ctx.streamStartTime ? Date.now() - ctx.streamStartTime : 0;
        const lastMsg = ctx.currentSession.messages[ctx.currentSession.messages.length - 1];
        tokenTracker.recordRequest({
            model: config.get<string>('model', 'mercury-2'),
            effort: config.get<string>('reasoningEffort', 'medium'),
            command: mode || 'chat',
            provider: (ctx.router?.lastUsedProvider as any) ?? 'mercury',
            apiInputTokens: lastUsage?.prompt_tokens,
            apiOutputTokens: lastUsage?.completion_tokens,
            apiTotalTokens: lastUsage?.total_tokens,
            estimatedInputChars: expandedText.length,
            estimatedOutputChars: (lastMsg?.content || '').length,
            toolCalls: ctx.currentSession.messages.filter(m => m.role === 'tool').length,
            rounds: 1,
            durationMs,
        });

        postMessage(ctx, {
            type: 'endStream',
            usage: lastUsage ? {
                prompt: lastUsage.prompt_tokens, completion: lastUsage.completion_tokens,
                total: lastUsage.total_tokens, reasoning: lastUsage.reasoning_tokens || 0,
                cached: lastUsage.cached_input_tokens || 0,
            } : undefined,
            followUps: generateFollowUps(mode, ctx.activeFileContext),
            provider: ctx.router?.lastUsedProviderLabel ?? 'Mercury',
            responseTime,
        });
        endStreamingUi(ctx);
        ctx.streamCompleteListeners.forEach(fn => fn(ctx.currentSession?.title || 'Response'));

        // G7 fix: record task learning
        learningsManager.recordLearning({
            task: text.slice(0, 200),
            outcome: 'success',
            toolsUsed: ctx.currentSession.messages.filter(m => m.role === 'tool').map(m => (m as any).tool_call_id || '').filter(Boolean).slice(0, 5),
            tokensUsed: lastUsage?.total_tokens ?? 0,
            costUsd: tokenTracker.getLastRequestCost(),
            durationMs,
            errorPatterns: [],
            timestamp: Date.now(),
        });
    } catch (error: unknown) {
        // Flush any remaining stream data before cleanup
        flushStreamBatch(ctx);
        endStreamingUi(ctx);
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage === 'Request was cancelled' || (error instanceof DOMException && error.name === 'AbortError')) {
            // Save partial session state on cancellation
            if (ctx.currentSession) {
                ctx.currentSession.updatedAt = Date.now();
                ctx.storage.saveSession(ctx.currentSession);
            }
            postMessage(ctx, { type: 'endStream', cancelled: true });
        } else {
            postMessage(ctx, { type: 'streamError', error: errorMessage });

            // G3 fix: record error pattern
            const category = /timeout|timed/i.test(errorMessage) ? 'timeout'
                : /rate.?limit|429/i.test(errorMessage) ? 'rate-limit'
                : /auth|401|403/i.test(errorMessage) ? 'auth'
                : /network|ECONNREFUSED/i.test(errorMessage) ? 'network'
                : 'runtime';
            learningsManager.recordError(
                errorMessage.slice(0, 120),
                category,
                'auto-retry via provider fallback',
                [],
            );
        }
    }
}
