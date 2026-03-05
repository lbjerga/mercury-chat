/**
 * utils/logger.ts — Structured logger for Mercury Chat
 *
 * Improvement #6: Levelled logger (debug, info, warn, error) that writes
 * to the VS Code Output Channel. The log level is controlled by the
 * `mercuryChat.logLevel` setting so users can toggle verbose output
 * without restarting the extension.
 *
 * Usage:
 *   import { logger } from './utils/logger';
 *   logger.info('Router initialised');
 *   logger.debug('Provider probe result', { provider: 'ollama', ok: true });
 *   logger.error('Stream failed', err);
 */

import * as vscode from 'vscode';

// ──────────────────────────────────────────────
// Log levels
// ──────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4,
};

// ──────────────────────────────────────────────
// Logger class
// ──────────────────────────────────────────────

export class Logger {
    private _channel: vscode.OutputChannel | undefined;
    private _level: LogLevel = 'info';

    /** Lazy-create the output channel */
    private _getChannel(): vscode.OutputChannel {
        if (!this._channel) {
            this._channel = vscode.window.createOutputChannel('Mercury Chat');
        }
        return this._channel;
    }

    /** Set the minimum log level */
    setLevel(level: LogLevel): void {
        this._level = level;
    }

    /** Current log level */
    get level(): LogLevel {
        return this._level;
    }

    /** Read the level from VS Code settings (call on activation + config change) */
    syncLevelFromConfig(): void {
        const config = vscode.workspace.getConfiguration('mercuryChat');
        const level = config.get<string>('logLevel', 'info') as LogLevel;
        if (LEVEL_ORDER[level] !== undefined) {
            this._level = level;
        }
    }

    // ── Core log methods ──

    debug(message: string, ...data: unknown[]): void {
        this._log('debug', message, data);
    }

    info(message: string, ...data: unknown[]): void {
        this._log('info', message, data);
    }

    warn(message: string, ...data: unknown[]): void {
        this._log('warn', message, data);
    }

    error(message: string, ...data: unknown[]): void {
        this._log('error', message, data);
    }

    // ── Specialised helpers (mirror existing outputChannel API) ──

    /** Log a tool call with optional result */
    toolCall(toolName: string, args: string, result?: string, isError?: boolean): void {
        if (LEVEL_ORDER[this._level] > LEVEL_ORDER.info) { return; }
        const ch = this._getChannel();
        ch.appendLine(`[${this._ts()}] [TOOL] ${toolName}`);
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
    apiRequest(model: string, messageCount: number, toolCount: number): void {
        this.info(`[API] Request → ${model} (${messageCount} messages, ${toolCount} tools)`);
    }

    /** Log an API response */
    apiResponse(contentLength: number, toolCallCount: number, tokens?: number): void {
        const parts = [`${contentLength} chars`];
        if (toolCallCount > 0) { parts.push(`${toolCallCount} tool calls`); }
        if (tokens) { parts.push(`${tokens} tokens`); }
        this.info(`[API] Response ← ${parts.join(', ')}`);
    }

    /** Log a Rapid Code phase */
    rapidPhase(phase: string, message: string): void {
        this.info(`[RAPID] [${phase.toUpperCase()}] ${message}`);
    }

    /** Show the output channel to the user */
    show(): void {
        this._getChannel().show();
    }

    /** Get the raw output channel (for legacy compatibility) */
    get channel(): vscode.OutputChannel {
        return this._getChannel();
    }

    /** Dispose the output channel */
    dispose(): void {
        this._channel?.dispose();
        this._channel = undefined;
    }

    // ── Internal ──

    private _log(level: LogLevel, message: string, data: unknown[]): void {
        if (LEVEL_ORDER[level] < LEVEL_ORDER[this._level]) { return; }

        const tag = level.toUpperCase().padEnd(5);
        let line = `[${this._ts()}] [${tag}] ${message}`;

        if (data.length > 0) {
            const extra = data.map(d => {
                if (d instanceof Error) { return d.stack ?? d.message; }
                if (typeof d === 'object') {
                    try { return JSON.stringify(d); } catch { return String(d); }
                }
                return String(d);
            }).join(' ');
            line += ` ${extra}`;
        }

        this._getChannel().appendLine(line);
    }

    private _ts(): string {
        return new Date().toISOString();
    }
}

/** Singleton logger instance — import this everywhere */
export const logger = new Logger();
