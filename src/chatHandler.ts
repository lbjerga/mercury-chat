/**
 * chatHandler.ts — Copilot Chat request handler (slim orchestrator)
 *
 * All helpers extracted into focused modules:
 *   prompts.ts, toolDescriptions.ts, contextBuilders.ts,
 *   followUps.ts, rapidCommandHandler.ts
 */

import * as vscode from 'vscode';
import { MercuryClient, TokenUsage } from './mercuryClient';
import { TOOL_DEFINITIONS, executeTool, READ_ONLY_TOOLS } from './tools';
import { COMMAND_PROMPTS } from './prompts';
import { describeToolCall, summarizeToolResult } from './toolDescriptions';
import { buildMessages, detectIntent, getCachedDiagnostics } from './contextBuilders';
import { logInfo, logToolCall, logApiRequest, logApiResponse } from './outputChannel';
import { autoDetectEffort, estimateTokens, ReasoningEffort } from './autoReasoning';
import { generateFollowUps } from './followUps';
import { handleRapidCommand } from './rapidCommandHandler';
import { generateId } from './utils';
import { tokenTracker } from './tokenTracker';
import { ProviderRouter } from './providers';
import { responseCache } from './responseCache';
import { selectModel } from './modelSelector';
import { getStickyModel } from './promptCache';

// ──────────────────────────────────────────────
// Main handler factory
// ──────────────────────────────────────────────

export function createChatCommand(client: MercuryClient, router?: ProviderRouter) {
    const alwaysAllowed = new Set<string>();
    const handler: vscode.ChatRequestHandler = async (
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> => {
        const config = vscode.workspace.getConfiguration('mercuryChat');
        const apiKey = config.get<string>('apiKey', '');

        // Check if ANY provider is available (not just Mercury)
        const hasAnyProvider = router
            ? !!router.selectProvider()
            : !!apiKey;

        if (!hasAnyProvider) {
            stream.markdown(
                '⚠️ **No provider available.**\n\n' +
                'Configure at least one provider in Settings:\n' +
                '- **Copilot** — install GitHub Copilot extension and sign in\n' +
                '- **OpenRouter** — set `mercuryChat.openRouterApiKey`\n' +
                '- **Ollama** — run `ollama serve` locally\n' +
                '- **Mercury** — set `mercuryChat.apiKey`\n\n' +
                'Then adjust `mercuryChat.routeOrder` to set fallback priority.\n'
            );
            return { metadata: { command: request.command || 'chat' } };
        }

        // Base config — reasoning effort may be overridden by auto-detect below
        const manualEffort = config.get<string>('reasoningEffort', 'medium') as ReasoningEffort;
        client.updateConfig({
            apiKey,
            baseUrl: config.get<string>('apiBaseUrl', 'https://api.inceptionlabs.ai/v1'),
            model: config.get<string>('model', 'mercury-2'),
            temperature: config.get<number>('temperature', 0.6),
            maxTokens: config.get<number>('maxTokens', 4096),
            reasoningEffort: manualEffort,
        });

        // Auto-detect intent
        let effectiveCommand = request.command;
        if (!effectiveCommand) {
            const detected = detectIntent(request.prompt);
            if (detected) {
                effectiveCommand = detected;
                stream.markdown(`> 🔍 Detected intent: **${detected}** (based on active file diagnostics)\n\n`);
            }
        }

        // /rapid → Rapid Code autonomous agent
        if (effectiveCommand === 'rapid') {
            return await handleRapidCommand(request, stream, token, client, config);
        }

        const commandPrompt = effectiveCommand ? COMMAND_PROMPTS[effectiveCommand] : undefined;
        const systemPrompt = config.get<string>(
            'systemPrompt',
            'You are Mercury 2, an expert coding assistant by Inception. Provide clear, accurate, and well-structured code with explanations.'
        );
        const autoContext = config.get<boolean>('autoContext', true);
        const autoRetry = config.get<boolean>('autoRetry', true);
        const streamTimeout = config.get<number>('streamTimeout', 60) * 1000;

        stream.progress('Preparing context...');
        const messages = await buildMessages(request, context, systemPrompt, commandPrompt, autoContext);

        // #2 Smart model selection — classify task tier and get model recommendation
        const contextTokenEstimate = messages.reduce((sum, m) =>
            sum + (typeof m.content === 'string' ? Math.ceil(m.content.length / 4) : 0), 0);
        const modelRec = selectModel(request.prompt, contextTokenEstimate);
        // Sticky model: prefer same model across turns for provider-side cache reuse
        const stickyModel = getStickyModel(modelRec.tier, modelRec.openRouterModel);
        logInfo(`[ModelSelector] Tier: ${modelRec.tier}, Mercury effort: ${modelRec.mercuryEffort}${stickyModel ? `, OpenRouter model: ${stickyModel}` : ''}`);

        // Check response cache for identical recent prompts (non-tool-call only)
        let fullResponseContent = '';
        const cached = responseCache.get(messages);
        if (cached) {
            logInfo('Response cache HIT — returning cached response');
            stream.markdown(cached.content);
            fullResponseContent = cached.content;
            const footer = `_Cached response · ${cached.usage?.total_tokens ?? 0} tokens_`;
            stream.markdown(`\n\n---\n${footer}`);
            return {
                metadata: { command: effectiveCommand || 'chat' },
                ...(config.get<boolean>('followUpSuggestions', true) ? {
                    followUp: generateFollowUps(effectiveCommand, request.prompt, fullResponseContent),
                } : {}),
            } as vscode.ChatResult;
        }

        // Auto-detect reasoning effort based on request complexity
        const autoEffort = config.get<boolean>('autoReasoningEffort', true);
        let activeEffort = manualEffort;
        if (autoEffort) {
            const editor = vscode.window.activeTextEditor;
            const diagnostics = editor ? getCachedDiagnostics(editor.document.uri) : [];
            const hasErrors = diagnostics.some(d => d.severity === vscode.DiagnosticSeverity.Error);
            const detected = autoDetectEffort({
                prompt: request.prompt,
                command: effectiveCommand,
                referenceCount: request.references.length,
                referenceSize: request.references.reduce((sum, r) => {
                    if (typeof r.value === 'string') return sum + r.value.length;
                    return sum;
                }, 0),
                historyTurns: context.history.length,
                hasErrors,
                workspaceFileCount: 0,
                isFollowUp: context.history.length > 0,
            });
            activeEffort = detected.effort;
            client.updateConfig({ reasoningEffort: activeEffort });
            logInfo(`Auto reasoning: ${activeEffort} (${detected.reason})`);

            const effortIcons: Record<string, string> = { instant: '⚡', low: '🔵', medium: '🟡', high: '🔴' };
            stream.markdown(`> ${effortIcons[activeEffort] || '🟡'} Reasoning: **${activeEffort}** — ${detected.reason}\n\n`);
        }

        logInfo('Chat request: ' + (effectiveCommand || 'chat'));

        const abortController = new AbortController();
        token.onCancellationRequested(() => abortController.abort());

        try {
            const MAX_ROUNDS = config.get<number>('maxAgentRounds', 15);
            let lastUsage: TokenUsage | undefined;
            let totalToolCalls = 0;
            let totalInputTokens = 0;
            let totalOutputTokens = 0;
            let totalApiTokens = 0;
            let inputCharCount = 0;
            const startTime = Date.now();

            for (let round = 0; round < MAX_ROUNDS; round++) {
                logApiRequest(config.get<string>('model', 'mercury-2'), messages.length, 0);
                if (round > 0) {
                    stream.progress(`Thinking... (step ${round + 1})`);
                }

                // Auto-retry with backoff
                let result;
                let lastError: Error | undefined;
                const maxRetries = autoRetry ? 3 : 1;
                for (let attempt = 0; attempt < maxRetries; attempt++) {
                    try {
                        result = await (router
                            ? router.streamChat(
                                messages,
                                (tokenText) => {
                                    fullResponseContent += tokenText;
                                    stream.markdown(tokenText);
                                },
                                {
                                    signal: abortController.signal,
                                    tools: TOOL_DEFINITIONS,
                                    timeout: streamTimeout,
                                    model: stickyModel,
                                },
                            )
                            : client.streamChat(
                                messages,
                                (tokenText) => {
                                    fullResponseContent += tokenText;
                                    stream.markdown(tokenText);
                                },
                                abortController.signal,
                                TOOL_DEFINITIONS,
                                streamTimeout
                            ));
                        lastError = undefined;
                        break;
                    } catch (err: unknown) {
                        lastError = err instanceof Error ? err : new Error(String(err));
                        const msg = lastError.message;
                        const isRetryable = msg.includes('429') || msg.includes('500') ||
                            msg.includes('502') || msg.includes('503') || msg.includes('stalled');
                        if (isRetryable && attempt < maxRetries - 1) {
                            const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
                            stream.progress(`Retrying in ${delay / 1000}s... (attempt ${attempt + 2}/${maxRetries})`);
                            await new Promise(r => setTimeout(r, delay));
                            continue;
                        }
                        throw lastError;
                    }
                }

                if (!result) { throw lastError || new Error('No result from API'); }
                if (result.usage) {
                    lastUsage = result.usage;
                    totalInputTokens += result.usage.prompt_tokens || 0;
                    totalOutputTokens += result.usage.completion_tokens || 0;
                    totalApiTokens += result.usage.total_tokens || 0;
                }

                // Log API response
                logApiResponse(
                    result.content?.length || 0,
                    result.toolCalls?.length || 0,
                    result.usage?.total_tokens
                );

                // Handle tool calls
                if (result.toolCalls && result.toolCalls.length > 0) {
                    // ═══ Tool call deduplication: skip duplicate name+args in same round ═══
                    const seenToolKeys = new Set<string>();
                    const dedupedToolCalls = result.toolCalls.filter(tc => {
                        const key = tc.function.name + '::' + tc.function.arguments;
                        if (seenToolKeys.has(key)) return false;
                        seenToolKeys.add(key);
                        return true;
                    });
                    const tcMsg = {
                        role: 'assistant',
                        content: result.content || null,
                        tool_calls: result.toolCalls.map(t => ({
                            id: t.id,
                            type: 'function' as const,
                            function: { name: t.function.name, arguments: t.function.arguments },
                        })),
                    };
                    messages.push(tcMsg as any);

                    // ── Parallel read-only tools, sequential write tools ──
                    const readToolCalls = dedupedToolCalls.filter(tc => READ_ONLY_TOOLS.has(tc.function.name));
                    const writeToolCalls = dedupedToolCalls.filter(tc => !READ_ONLY_TOOLS.has(tc.function.name));

                    // Batch all read-only tools in parallel
                    if (readToolCalls.length > 0) {
                        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
                        for (const tc of readToolCalls) {
                            totalToolCalls++;
                            stream.progress(describeToolCall(tc.function.name, tc.function.arguments));
                        }
                        const readResults = await Promise.all(
                            readToolCalls.map(tc => executeTool(tc, workspaceRoot, router))
                        );
                        for (let i = 0; i < readToolCalls.length; i++) {
                            const tc = readToolCalls[i];
                            const toolResult = readResults[i];
                            const summary = summarizeToolResult(tc.function.name, tc.function.arguments, toolResult.content, toolResult.isError);
                            stream.markdown(`\n\n> ${summary}\n`);
                            messages.push({
                                role: 'tool',
                                tool_call_id: toolResult.toolCallId || tc.id || generateId(),
                                content: toolResult.content,
                            } as any);
                        }
                    }

                    // Run write/destructive tools sequentially
                    for (const tc of writeToolCalls) {
                        totalToolCalls++;
                        const friendlyDesc = describeToolCall(tc.function.name, tc.function.arguments);

                        // Allow specific functions to bypass approval
                        if (alwaysAllowed.has(tc.function.name)) {
                            stream.progress(friendlyDesc);
                            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
                            const toolResult = await executeTool(tc, workspaceRoot, router);
                            const summary = summarizeToolResult(tc.function.name, tc.function.arguments, toolResult.content, toolResult.isError);
                            stream.markdown(`\n\n> ${summary}\n`);
                            messages.push({
                                role: 'tool',
                                tool_call_id: toolResult.toolCallId || tc.id || generateId(),
                                content: toolResult.content,
                            } as any);
                            continue;
                        }

                        const destructive = ['write_file', 'edit_file', 'run_command'];
                        let approved = true;
                        if (destructive.includes(tc.function.name)) {
                            const humanLabel = tc.function.name === 'write_file' ? 'Write File'
                                : tc.function.name === 'edit_file' ? 'Edit File'
                                : 'Run Command';

                            let detail: string;
                            try {
                                const args = JSON.parse(tc.function.arguments);
                                if (tc.function.name === 'run_command') {
                                    detail = `Command: ${args.command}`;
                                } else if (tc.function.name === 'write_file') {
                                    detail = `File: ${args.path}\nContent: ${(args.content || '').slice(0, 200)}${(args.content || '').length > 200 ? '...' : ''}`;
                                } else {
                                    detail = `File: ${args.path}\nReplace: "${(args.oldString || '').slice(0, 100)}"\nWith: "${(args.newString || '').slice(0, 100)}"`;
                                }
                            } catch {
                                detail = tc.function.arguments;
                            }

                            const choice = await vscode.window.showWarningMessage(
                                `Mercury wants to: ${humanLabel}`,
                                { modal: true, detail },
                                'Allow', 'Always Allow', 'Deny'
                            );
                            if (choice === 'Always Allow') {
                                alwaysAllowed.add(tc.function.name);
                                approved = true;
                            } else {
                                approved = choice === 'Allow';
                            }
                        }

                        if (!approved) {
                            stream.markdown(`\n\n> ⏭️ Skipped: ${friendlyDesc}\n`);
                            messages.push({
                                role: 'tool',
                                tool_call_id: tc.id || generateId(),
                                content: 'Tool execution was denied by the user.',
                            } as any);
                            continue;
                        }

                        stream.progress(friendlyDesc);

                        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
                        const toolResult = await executeTool(tc, workspaceRoot, router);
                        logToolCall(tc.function.name, tc.function.arguments);

                        const summary = summarizeToolResult(tc.function.name, tc.function.arguments, toolResult.content, toolResult.isError);
                        stream.markdown(`\n\n> ${summary}\n`);

                        messages.push({
                            role: 'tool',
                            tool_call_id: toolResult.toolCallId || tc.id || generateId(),
                            content: toolResult.content,
                        } as any);
                    }

                    continue;
                }

                break;
            }

            // Usage & timing stats — record with token tracker
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const model = config.get<string>('model', 'mercury-2');

            // Estimate input chars from messages
            for (const m of messages) {
                if (typeof (m as any).content === 'string') {
                    inputCharCount += ((m as any).content as string).length;
                }
            }

            const record = tokenTracker.recordRequest({
                model,
                effort: activeEffort,
                command: effectiveCommand || 'chat',
                provider: (router?.lastUsedProvider as any) ?? 'mercury',
                apiInputTokens: totalInputTokens,
                apiOutputTokens: totalOutputTokens,
                apiTotalTokens: totalApiTokens,
                estimatedInputChars: inputCharCount,
                estimatedOutputChars: fullResponseContent.length,
                toolCalls: totalToolCalls,
                rounds: Math.min(config.get<number>('maxAgentRounds', 15), totalToolCalls + 1),
                durationMs: Date.now() - startTime,
            });

            const footer = tokenTracker.formatFooterStats(record);
            stream.markdown(`\n\n---\n_${footer}_`);

            // Cache the response if no tool calls were made
            if (totalToolCalls === 0 && fullResponseContent.length > 0) {
                responseCache.set(messages, {
                    content: fullResponseContent,
                    usage: lastUsage,
                });
            }

        } catch (error: unknown) {
            if (error instanceof Error && error.message === 'Request was cancelled') {
                stream.markdown('\n\n*Response cancelled.*');
            } else {
                const errorMessage = error instanceof Error ? error.message : String(error);
                let guidance = '';
                if (errorMessage.includes('401') || errorMessage.includes('403') || errorMessage.toLowerCase().includes('auth')) {
                    guidance = '\n\n💡 **Fix:** Check your API key in Settings → `mercuryChat.apiKey`';
                } else if (errorMessage.includes('429') || errorMessage.toLowerCase().includes('rate')) {
                    guidance = '\n\n💡 **Fix:** Rate limited — wait a moment and try again';
                } else if (errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND') || errorMessage.includes('stalled')) {
                    guidance = '\n\n💡 **Fix:** Network issue — check your connection and API base URL';
                } else if (errorMessage.includes('500') || errorMessage.includes('502') || errorMessage.includes('503')) {
                    guidance = '\n\n💡 **Fix:** Mercury API server error — try again in a moment';
                }
                stream.markdown(`\n\n❌ **Error:** ${errorMessage}${guidance}`);
                console.error('[Mercury Chat] Error:', error);
            }
        }

        // Follow-up suggestions
        const followUpSuggestions = config.get<boolean>('followUpSuggestions', true);

        return {
            metadata: { command: effectiveCommand || 'chat' },
            ...(followUpSuggestions ? {
                followUp: generateFollowUps(effectiveCommand, request.prompt, fullResponseContent),
            } : {}),
        } as vscode.ChatResult;
    };

    return handler;
}

export const createChatHandler = createChatCommand;
