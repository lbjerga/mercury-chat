/**
 * rapidCode/lmTool.ts — VS Code Language Model Tool registration
 */

import * as vscode from 'vscode';
import { MercuryClient } from '../mercuryClient';
import { RapidCodeInput } from '../types';
import { executeRapidCode } from './orchestrator';

/**
 * Register `mercury_rapid_code` as a VS Code Language Model Tool.
 * Any AI chat participant (Copilot, Claude, Gemini) can call this tool.
 */
export function registerRapidCodeTool(
    context: vscode.ExtensionContext,
    client: MercuryClient
): void {
    if (!vscode.lm || typeof vscode.lm.registerTool !== 'function') {
        console.log('[Mercury Chat] vscode.lm.registerTool not available — Rapid Code tool not registered');
        return;
    }

    const tool = vscode.lm.registerTool('mercury_rapid_code', {
        prepareInvocation(
            options: vscode.LanguageModelToolInvocationPrepareOptions<RapidCodeInput>,
            _token: vscode.CancellationToken
        ) {
            const input = options.input;
            return {
                invocationMessage: `🚀 Rapid Code: ${input.task?.slice(0, 100) || 'coding task'}${input.mode ? ` (${input.mode} mode)` : ''}`,
            };
        },

        async invoke(
            options: vscode.LanguageModelToolInvocationOptions<RapidCodeInput>,
            token: vscode.CancellationToken
        ) {
            const input = options.input;

            if (!input.task) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify({
                        success: false,
                        summary: 'Error: No task provided. Please specify what you want to build.',
                        gaps: [{ type: 'error', message: 'Missing task description' }],
                    }))
                ]);
            }

            const abortController = new AbortController();
            token.onCancellationRequested(() => abortController.abort());

            const config = vscode.workspace.getConfiguration('mercuryChat');
            client.updateConfig({
                apiKey: config.get<string>('apiKey', ''),
                baseUrl: config.get<string>('apiBaseUrl', 'https://api.inceptionlabs.ai/v1'),
                model: config.get<string>('model', 'mercury-2'),
                temperature: config.get<number>('temperature', 0.6),
                maxTokens: config.get<number>('maxTokens', 32768),
                reasoningEffort: config.get<string>('reasoningEffort', 'medium') as any,
            });

            const statusMsg = vscode.window.setStatusBarMessage('$(loading~spin) Rapid Code running...');

            try {
                const result = await executeRapidCode(
                    input,
                    client,
                    (phase, msg) => {
                        vscode.window.setStatusBarMessage(`$(loading~spin) Rapid Code [${phase}]: ${msg}`, 3000);
                    },
                    abortController.signal
                );

                statusMsg.dispose();

                const resultForAI = {
                    success: result.success,
                    summary: result.summary,
                    plan: result.plan,
                    filesChanged: result.filesChanged,
                    validation: result.validation ? {
                        errors: result.validation.errors,
                        warnings: result.validation.warnings,
                    } : undefined,
                    testResult: result.testResult ? {
                        passed: result.testResult.passed,
                        failed: result.testResult.failed,
                    } : undefined,
                    audit: result.audit,
                    gaps: result.gaps,
                    iterations: result.iterations,
                    totalToolCalls: result.totalToolCalls,
                    totalTimeSeconds: (result.totalTime / 1000).toFixed(1),
                };

                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(resultForAI, null, 2))
                ]);
            } catch (err: unknown) {
                statusMsg.dispose();
                const msg = err instanceof Error ? err.message : String(err);
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify({
                        success: false,
                        summary: `Rapid Code failed: ${msg}`,
                        gaps: [{ type: 'error', message: msg }],
                    }))
                ]);
            }
        },
    });

    context.subscriptions.push(tool);
    console.log('[Mercury Chat] Registered mercury_rapid_code Language Model Tool');
}
