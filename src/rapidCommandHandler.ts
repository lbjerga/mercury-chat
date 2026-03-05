/**
 * rapidCommandHandler.ts — /rapid command handler for Copilot Chat
 */

import * as vscode from 'vscode';
import { MercuryClient } from './mercuryClient';
import { executeRapidCode } from './rapidCode';

export async function handleRapidCommand(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    client: MercuryClient,
    config: vscode.WorkspaceConfiguration
): Promise<vscode.ChatResult> {
    const task = request.prompt;
    if (!task.trim()) {
        stream.markdown('⚠️ **Please describe the coding task.** Example:\n\n`@mercury /rapid Add a login page with email validation`');
        return { metadata: { command: 'rapid' } };
    }

    const abortController = new AbortController();
    token.onCancellationRequested(() => abortController.abort());

    // Determine mode from prompt hints
    let mode: 'quick' | 'validate' | 'test' | 'full' = 'full';
    if (/\bquick\b/i.test(task)) { mode = 'quick'; }
    else if (/\bno.?test/i.test(task)) { mode = 'validate'; }

    // Collect referenced files
    const files: string[] = [];
    for (const ref of request.references) {
        if (ref.value instanceof vscode.Uri) {
            files.push(vscode.workspace.asRelativePath(ref.value));
        }
    }

    stream.markdown(`## 🚀 Rapid Code\n\n**Task:** ${task}\n**Mode:** ${mode}${files.length > 0 ? `\n**Files:** ${files.join(', ')}` : ''}\n\n---\n\n`);

    const phaseEmoji: Record<string, string> = {
        plan: '📋', coding: '⚡', validate: '🔍', test: '🧪',
        audit: '📝', 'self-heal': '🔄', done: '✅', error: '❌',
    };

    let currentPhase = '';

    try {
        const result = await executeRapidCode(
            { task, mode, files: files.length > 0 ? files : undefined },
            client,
            (phase, msg) => {
                if (phase !== currentPhase) {
                    currentPhase = phase;
                    const emoji = phaseEmoji[phase] || '▶️';
                    stream.markdown(`\n### ${emoji} ${phase.charAt(0).toUpperCase() + phase.slice(1)}\n\n`);
                }
                stream.progress(msg);
            },
            abortController.signal
        );

        // Render result
        stream.markdown(`\n---\n\n### 📊 Result\n\n`);
        stream.markdown(`**Status:** ${result.success ? '✅ Success' : '⚠️ Completed with gaps'}\n`);
        stream.markdown(`**Iterations:** ${result.iterations} | **Tool calls:** ${result.totalToolCalls} | **Time:** ${(result.totalTime / 1000).toFixed(1)}s\n`);

        if (result.filesChanged.length > 0) {
            stream.markdown(`\n**Files changed:**\n`);
            for (const f of result.filesChanged) {
                stream.markdown(`- \`${f}\`\n`);
            }
        }

        if (result.validation) {
            stream.markdown(`\n**Validation:** ${result.validation.errors} errors, ${result.validation.warnings} warnings\n`);
        }

        if (result.testResult) {
            stream.markdown(`\n**Tests:** ${result.testResult.passed} passed, ${result.testResult.failed} failed\n`);
        }

        if (result.gaps.length > 0) {
            stream.markdown(`\n**Remaining gaps:**\n`);
            for (const g of result.gaps) {
                stream.markdown(`- \\[${g.type}\\]${g.file ? ` \`${g.file}\`` : ''}${g.line ? `:${g.line}` : ''} — ${g.message}\n`);
            }
        }

        if (result.audit) {
            stream.markdown(`\n<details><summary><b>Full Audit Report</b></summary>\n\n${result.audit}\n\n</details>\n`);
        }

        if (result.plan) {
            stream.markdown(`\n<details><summary><b>Execution Plan</b></summary>\n\n${result.plan}\n\n</details>\n`);
        }

        stream.markdown(`\n---\n_Rapid Code · ${result.iterations} iteration(s) · ${result.totalToolCalls} tool calls · ${(result.totalTime / 1000).toFixed(1)}s_`);

        return {
            metadata: { command: 'rapid' },
            followUp: result.success
                ? [
                    { prompt: 'Run the tests to verify', label: 'Run tests' },
                    { prompt: 'Show me what changed', label: 'Show changes' },
                    { prompt: 'Add documentation for the new code', label: 'Add docs' },
                ]
                : [
                    { prompt: `Fix the remaining gaps: ${result.gaps.map(g => g.message).join('; ')}`, label: 'Fix gaps' },
                    { prompt: 'Show me the errors in detail', label: 'Show errors' },
                ],
        } as vscode.ChatResult;

    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        stream.markdown(`\n\n❌ **Rapid Code failed:** ${msg}`);
        return { metadata: { command: 'rapid' } };
    }
}
