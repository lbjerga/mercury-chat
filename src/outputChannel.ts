/**
 * outputChannel.ts — Mercury Output Channel for logging & debugging
 *
 * Improvement #3: Output channel logging for all API calls,
 * tool executions, and Rapid Code phases.
 */

import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

/** Get or create the Mercury output channel */
export function getMercuryOutputChannel(): vscode.OutputChannel {
    if (!channel) {
        channel = vscode.window.createOutputChannel('Mercury Chat');
    }
    return channel;
}

/** Log an informational message */
export function logInfo(message: string): void {
    const ch = getMercuryOutputChannel();
    ch.appendLine(`[${new Date().toISOString()}] [INFO] ${message}`);
}

/** Log an error message */
export function logError(message: string): void {
    const ch = getMercuryOutputChannel();
    ch.appendLine(`[${new Date().toISOString()}] [ERROR] ${message}`);
}

/** Log a tool call */
export function logToolCall(toolName: string, args: string, result?: string, isError?: boolean): void {
    const ch = getMercuryOutputChannel();
    ch.appendLine(`[${new Date().toISOString()}] [TOOL] ${toolName}`);
    try {
        const parsed = JSON.parse(args);
        ch.appendLine(`  Args: ${JSON.stringify(parsed, null, 2).split('\n').join('\n  ')}`);
    } catch {
        ch.appendLine(`  Args: ${args.slice(0, 500)}`);
    }
    if (result !== undefined) {
        const status = isError ? 'ERROR' : 'OK';
        ch.appendLine(`  Result [${status}]: ${result.slice(0, 500)}${result.length > 500 ? '...' : ''}`);
    }
}

/** Log an API request */
export function logApiRequest(model: string, messageCount: number, toolCount: number): void {
    const ch = getMercuryOutputChannel();
    ch.appendLine(`[${new Date().toISOString()}] [API] Request → ${model} (${messageCount} messages, ${toolCount} tools)`);
}

/** Log an API response */
export function logApiResponse(contentLength: number, toolCallCount: number, tokens?: number): void {
    const ch = getMercuryOutputChannel();
    const parts = [`${contentLength} chars`];
    if (toolCallCount > 0) { parts.push(`${toolCallCount} tool calls`); }
    if (tokens) { parts.push(`${tokens} tokens`); }
    ch.appendLine(`[${new Date().toISOString()}] [API] Response ← ${parts.join(', ')}`);
}

/** Log a Rapid Code phase */
export function logRapidPhase(phase: string, message: string): void {
    const ch = getMercuryOutputChannel();
    ch.appendLine(`[${new Date().toISOString()}] [RAPID] [${phase.toUpperCase()}] ${message}`);
}

/** Show the output channel */
export function showOutputChannel(): void {
    getMercuryOutputChannel().show();
}
