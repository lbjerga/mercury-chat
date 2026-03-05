/**
 * tools/rapidCodeTool.ts — Rapid Code meta-tool wrapper
 */

import * as vscode from 'vscode';
import { MercuryClient } from '../mercuryClient';
import { executeRapidCode } from '../rapidCode';
import { RapidCodeInput } from '../types';

/** rapid_code — autonomous coding meta-tool */
export async function toolRapidCode(
    args: Record<string, unknown>
): Promise<{ content: string; isError: boolean }> {
    const task = args.task as string;
    if (!task) {
        return { content: 'Error: missing required parameter "task"', isError: true };
    }

    const config = vscode.workspace.getConfiguration('mercuryChat');
    const apiKey = config.get<string>('apiKey', '');
    if (!apiKey) {
        return { content: 'Error: Mercury API key not configured. Set mercuryChat.apiKey in settings.', isError: true };
    }

    const client = new MercuryClient({
        apiKey,
        baseUrl: config.get<string>('apiBaseUrl', 'https://api.inceptionlabs.ai/v1'),
        model: config.get<string>('model', 'mercury-2'),
        temperature: config.get<number>('temperature', 0.6),
        maxTokens: config.get<number>('maxTokens', 32768),
        reasoningEffort: config.get<string>('reasoningEffort', 'medium') as 'instant' | 'low' | 'medium' | 'high',
    });

    const input: RapidCodeInput = {
        task,
        mode: (args.mode as RapidCodeInput['mode']) || 'full',
        files: args.files as string[] | undefined,
        context: args.context as string | undefined,
    };

    const progressLog: string[] = [];
    const result = await executeRapidCode(
        input,
        client,
        (phase, msg) => { progressLog.push(`[${phase}] ${msg}`); }
    );

    const lines: string[] = [
        `# Rapid Code Result`,
        ``,
        `**Status:** ${result.success ? '✅ Success' : '⚠️ Completed with gaps'}`,
        `**Iterations:** ${result.iterations}`,
        `**Tool calls:** ${result.totalToolCalls}`,
        `**Time:** ${(result.totalTime / 1000).toFixed(1)}s`,
        `**Files changed:** ${result.filesChanged.length > 0 ? result.filesChanged.join(', ') : 'none'}`,
        ``,
        `## Plan`,
        result.plan,
    ];

    if (result.validation) {
        lines.push('', '## Validation', `Errors: ${result.validation.errors}, Warnings: ${result.validation.warnings}`);
        if (result.validation.errors > 0) { lines.push(result.validation.details); }
    }
    if (result.testResult) {
        lines.push('', '## Tests', `Passed: ${result.testResult.passed}, Failed: ${result.testResult.failed}`);
        if (result.testResult.failed > 0) { lines.push(result.testResult.output.slice(0, 1000)); }
    }
    if (result.audit) {
        lines.push('', '## Audit', result.audit);
    }
    if (result.gaps.length > 0) {
        lines.push('', '## Gaps');
        for (const g of result.gaps) {
            lines.push(`- [${g.type}]${g.file ? ` ${g.file}` : ''}${g.line ? `:${g.line}` : ''}: ${g.message}`);
        }
    }

    lines.push('', '## Progress Log');
    for (const l of progressLog) { lines.push(l); }

    return {
        content: lines.join('\n'),
        isError: !result.success,
    };
}
