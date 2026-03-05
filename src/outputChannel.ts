/**
 * outputChannel.ts — Mercury Output Channel for logging & debugging
 *
 * Thin compatibility shim that delegates to the new structured logger
 * (src/utils/logger.ts). Existing call sites continue to work unchanged.
 *
 * New code should import { logger } from './utils/logger' directly.
 */

import { logger } from './utils/logger';

/** @deprecated Use `logger.channel` instead */
export function getMercuryOutputChannel() { return logger.channel; }

/** @deprecated Use `logger.info()` */
export function logInfo(message: string): void { logger.info(message); }

/** @deprecated Use `logger.error()` */
export function logError(message: string): void { logger.error(message); }

/** @deprecated Use `logger.toolCall()` */
export function logToolCall(toolName: string, args: string, result?: string, isError?: boolean): void {
    logger.toolCall(toolName, args, result, isError);
}

/** @deprecated Use `logger.apiRequest()` */
export function logApiRequest(model: string, messageCount: number, toolCount: number): void {
    logger.apiRequest(model, messageCount, toolCount);
}

/** @deprecated Use `logger.apiResponse()` */
export function logApiResponse(contentLength: number, toolCallCount: number, tokens?: number): void {
    logger.apiResponse(contentLength, toolCallCount, tokens);
}

/** @deprecated Use `logger.rapidPhase()` */
export function logRapidPhase(phase: string, message: string): void {
    logger.rapidPhase(phase, message);
}

/** @deprecated Use `logger.show()` */
export function showOutputChannel(): void { logger.show(); }
