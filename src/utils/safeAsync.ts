/**
 * utils/safeAsync.ts — Generic async error boundary
 *
 * Improvement #5: Wraps any async function so that uncaught rejections
 * are logged (via the structured logger) and converted to a
 * user-friendly fallback value instead of crashing the extension.
 *
 * Usage:
 *   const safeSend = safeAsync(sendMessage, 'Failed to send message');
 *   await safeSend(text);
 *
 *   // Or inline:
 *   await safeRun(() => router.streamChat(msgs, onToken, opts), 'Stream failed');
 */

import { logger } from './logger';

/**
 * Wrap an async function so that any thrown error is caught, logged,
 * and replaced with `fallbackValue` (default `undefined`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function safeAsync<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    label?: string,
    fallbackValue?: ReturnType<T> extends Promise<infer R> ? R : undefined,
): (...args: Parameters<T>) => Promise<ReturnType<T> extends Promise<infer R> ? R : undefined> {
    return async (...args: Parameters<T>) => {
        try {
            return await fn(...args);
        } catch (err) {
            logger.error(`[safeAsync] ${label ?? fn.name ?? 'anonymous'} failed`, err);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return fallbackValue as any;
        }
    };
}

/**
 * Run a one-shot async operation safely. Returns the result or the
 * fallback value on error.
 *
 *   const result = await safeRun(() => compute(), 'compute');
 */
export async function safeRun<T>(
    fn: () => Promise<T>,
    label?: string,
    fallbackValue?: T,
): Promise<T | undefined> {
    try {
        return await fn();
    } catch (err) {
        logger.error(`[safeRun] ${label ?? 'anonymous'} failed`, err);
        return fallbackValue;
    }
}

/**
 * Wrap an async VS Code command handler so errors are shown to the
 * user as an error notification rather than silently swallowed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function safeCommand<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    label?: string,
): (...args: Parameters<T>) => Promise<void> {
    return async (...args: Parameters<T>) => {
        try {
            await fn(...args);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`[Command] ${label ?? fn.name ?? 'unknown'}: ${msg}`, err);
            // Dynamic import to avoid hard dep on vscode in unit tests
            try {
                const vscode = await import('vscode');
                vscode.window.showErrorMessage(`Mercury Chat: ${msg}`);
            } catch { /* test env — no vscode */ }
        }
    };
}
