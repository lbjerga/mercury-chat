/**
 * rapidCodeHandler.ts — Sidebar rapid code execution with phase tracking
 * Extracted from chatViewProvider.ts
 */

import * as vscode from 'vscode';
import { ChatViewContext, postMessage, beginStreamingUi, endStreamingUi, enforceSessionMessageLimit } from '../chatViewContext';
import { executeRapidCode } from '../rapidCode';

export async function handleRapidCode(ctx: ChatViewContext): Promise<(taskText: string) => Promise<void>> {
    // Return a closure that handles rapid code execution with the given context
    return async (taskText: string): Promise<void> => {
        if (!taskText.trim()) {
            postMessage(ctx, { type: 'addMessage', role: 'assistant', content: '⚠️ **Please describe the coding task.** Example:\n\n`/rapid Add authentication middleware`' });
            return;
        }

        const config = vscode.workspace.getConfiguration('mercuryChat');
        const apiKey = config.get<string>('apiKey', '');
        if (!apiKey) {
            postMessage(ctx, { type: 'addMessage', role: 'assistant', content: '⚠️ **No API key configured.** Set `mercuryChat.apiKey` in settings.' });
            return;
        }

        if (ctx.currentSession) {
            ctx.currentSession.messages.push({ role: 'user', content: `/rapid ${taskText}` });
            enforceSessionMessageLimit(ctx);
        }
        postMessage(ctx, { type: 'addMessage', role: 'user', content: `/rapid ${taskText}` });

        beginStreamingUi(ctx);

        let mode: 'quick' | 'validate' | 'test' | 'full' = 'full';
        if (/\bquick\b/i.test(taskText)) { mode = 'quick'; }
        else if (/\bno.?test/i.test(taskText)) { mode = 'validate'; }

        postMessage(ctx, { type: 'streamToken', token: `## 🚀 Rapid Code\n\n**Task:** ${taskText}\n**Mode:** ${mode}\n\n---\n\n` });

        let currentPhase = '';
        const phaseEmoji: Record<string, string> = {
            plan: '📋', coding: '⚡', validate: '🔍', test: '🧪',
            audit: '📝', 'self-heal': '🔄', done: '✅', error: '❌',
        };

        try {
            const result = await executeRapidCode(
                { task: taskText, mode },
                ctx.client,
                (phase: string, msg: string) => {
                    if (phase !== currentPhase) {
                        currentPhase = phase;
                        const emoji = phaseEmoji[phase] || '▶️';
                        postMessage(ctx, { type: 'streamToken', token: `\n### ${emoji} ${phase.charAt(0).toUpperCase() + phase.slice(1)}\n\n` });
                    }
                    postMessage(ctx, { type: 'streamToken', token: `> ${msg}\n\n` });
                },
                undefined,
                ctx.router
            );

            const lines: string[] = [
                `\n---\n\n### 📊 Result\n\n`,
                `**Status:** ${result.success ? '✅ Success' : '⚠️ Completed with gaps'}\n`,
                `**Iterations:** ${result.iterations} | **Tool calls:** ${result.totalToolCalls} | **Time:** ${(result.totalTime / 1000).toFixed(1)}s\n`,
            ];
            if (result.filesChanged.length > 0) {
                lines.push(`\n**Files changed:** ${result.filesChanged.map((f: string) => '`' + f + '`').join(', ')}\n`);
            }
            if (result.validation) {
                lines.push(`\n**Validation:** ${result.validation.errors} errors, ${result.validation.warnings} warnings\n`);
            }
            if (result.testResult) {
                lines.push(`\n**Tests:** ${result.testResult.passed} passed, ${result.testResult.failed} failed\n`);
            }
            if (result.gaps.length > 0) {
                lines.push(`\n**Remaining gaps:**\n`);
                for (const g of result.gaps) {
                    lines.push(`- [${g.type}]${g.file ? ' `' + g.file + '`' : ''}${g.line ? ':' + g.line : ''}: ${g.message}\n`);
                }
            }
            postMessage(ctx, { type: 'streamToken', token: lines.join('') });

            const fullResponse = `🚀 Rapid Code completed: ${result.summary}`;
            if (ctx.currentSession) {
                ctx.currentSession.messages.push({ role: 'assistant', content: fullResponse });
                enforceSessionMessageLimit(ctx);
                ctx.currentSession.updatedAt = Date.now();
                ctx.storage.saveSession(ctx.currentSession);
            }

            postMessage(ctx, { type: 'endStream', responseTime: result.totalTime });
            endStreamingUi(ctx);
            ctx.streamCompleteListeners.forEach(fn => fn(ctx.currentSession?.title || 'Rapid Code'));

        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            postMessage(ctx, { type: 'streamToken', token: `\n\n❌ **Rapid Code failed:** ${msg}\n` });
            postMessage(ctx, { type: 'endStream' });
            endStreamingUi(ctx);
        }
    };
}
