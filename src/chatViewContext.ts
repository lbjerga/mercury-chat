/**
 * chatViewContext.ts — Shared context interface for extracted chatViewProvider modules
 *
 * All modules extracted from chatViewProvider.ts receive this context object
 * instead of importing the provider class, preventing circular dependencies.
 */

import * as vscode from 'vscode';
import { MercuryClient } from './mercuryClient';
import { ChatSession, SessionIndex, ActiveFileContext } from './types';
import { ChatStorage } from './storage';
import { ProviderRouter } from './providers';

/**
 * Shared mutable state passed to all extracted modules.
 * The main MercuryChatViewProvider owns these fields and passes
 * a reference to each sub-module so they can read/write shared state.
 */
export interface ChatViewContext {
    /** The webview view instance (undefined until resolveWebviewView) */
    view: vscode.WebviewView | undefined;
    /** The currently loaded chat session */
    currentSession: ChatSession | null;
    /** Session index (list of all sessions) */
    index: SessionIndex;
    /** Persistent storage for sessions */
    storage: ChatStorage;
    /** Mercury API client */
    client: MercuryClient;
    /** Multi-provider router (optional) */
    router: ProviderRouter | undefined;
    /** Extension URI for resource paths */
    extensionUri: vscode.Uri;
    /** Abort controller for current stream */
    abortController: AbortController | undefined;
    /** Active file context from the editor */
    activeFileContext: ActiveFileContext | undefined;
    /** Stream batch buffer for token batching */
    streamBatchBuffer: string;
    /** Stream batch timer */
    streamBatchTimer: NodeJS.Timeout | undefined;
    /** Input drafts per session */
    inputDrafts: Map<string, string>;
    /** Last user text (for retry) */
    lastUserText: string | undefined;
    /** Last user mode (for retry) */
    lastUserMode: string | undefined;
    /** Streaming state listeners */
    streamingStateListeners: ((streaming: boolean) => void)[];
    /** Stream complete listeners */
    streamCompleteListeners: ((title: string) => void)[];
    /** Stream indicator visible flag */
    streamIndicatorVisible: boolean;
    /** Stream indicator timer */
    streamIndicatorTimer: NodeJS.Timeout | undefined;
    /** Stream start time */
    streamStartTime: number | undefined;
    /** Last send timestamp for dedup */
    lastSendTimestamp: number;
    /** Cached workspace tree */
    cachedWorkspaceTree: string;
    /** Whether workspace tree is dirty */
    workspaceTreeDirty: boolean;
    /** Pending tool confirm resolver */
    pendingToolConfirm: { resolve: (approved: boolean) => void } | undefined;
}

/** Post a message to the webview, no-op if view is undefined */
export function postMessage(ctx: ChatViewContext, message: any): void {
    ctx.view?.webview.postMessage(message);
}

/** Enforce session message limit based on config */
export function enforceSessionMessageLimit(ctx: ChatViewContext): void {
    if (!ctx.currentSession) { return; }
    const cfg = vscode.workspace.getConfiguration('mercuryChat');
    const performanceMode = cfg.get<boolean>('performanceMode', false);
    const defaultLimit = performanceMode ? 250 : 500;
    const maxMessages = Math.max(50, cfg.get<number>('maxSessionMessages', defaultLimit));
    const messages = ctx.currentSession.messages;
    if (messages.length <= maxMessages) { return; }
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');
    const keepNonSystem = Math.max(0, maxMessages - systemMessages.length);
    ctx.currentSession.messages = [...systemMessages, ...nonSystemMessages.slice(-keepNonSystem)];
}

/** Begin streaming UI indicator with configurable delay */
export function beginStreamingUi(ctx: ChatViewContext): void {
    if (ctx.streamIndicatorTimer || ctx.streamIndicatorVisible) { return; }
    const cfg = vscode.workspace.getConfiguration('mercuryChat');
    const performanceMode = cfg.get<boolean>('performanceMode', false);
    const configuredDelay = Math.max(0, cfg.get<number>('spinnerDelayMs', 200));
    const delayMs = performanceMode ? Math.max(200, configuredDelay) : configuredDelay;
    ctx.streamIndicatorTimer = setTimeout(() => {
        ctx.streamIndicatorTimer = undefined;
        ctx.streamIndicatorVisible = true;
        ctx.view?.webview.postMessage({ type: 'startStream' });
        ctx.streamingStateListeners.forEach(fn => fn(true));
    }, delayMs);
}

/** End streaming UI indicator */
export function endStreamingUi(ctx: ChatViewContext): void {
    if (ctx.streamIndicatorTimer) {
        clearTimeout(ctx.streamIndicatorTimer);
        ctx.streamIndicatorTimer = undefined;
    }
    if (ctx.streamIndicatorVisible) {
        ctx.streamingStateListeners.forEach(fn => fn(false));
        ctx.streamIndicatorVisible = false;
    }
}

/** Flush accumulated streaming tokens to the webview */
export function flushStreamBatch(ctx: ChatViewContext): void {
    if (ctx.streamBatchBuffer.length > 0) {
        ctx.view?.webview.postMessage({ type: 'streamToken', token: ctx.streamBatchBuffer });
        ctx.streamBatchBuffer = '';
    }
    if (ctx.streamBatchTimer) {
        clearTimeout(ctx.streamBatchTimer);
        ctx.streamBatchTimer = undefined;
    }
}
