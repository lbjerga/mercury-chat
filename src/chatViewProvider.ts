/**
 * chatViewProvider.ts — Slim orchestrator for Mercury Chat webview.
 *
 * All heavy logic has been extracted into focused modules under
 * src/chat/, src/session/, src/webview/ and src/chatViewContext.ts.
 * This file owns the class fields, constructor, dispose, public API,
 * resolveWebviewView (message dispatch), and context wiring.
 */
import * as vscode from 'vscode';
import { MercuryClient } from './mercuryClient';
import { ChatSession, SessionIndex, ActiveFileContext } from './types';
import { ChatStorage } from './storage';
import { debounce } from './utils';
import { ProviderRouter } from './providers';
import { toolResultCache } from './tools';

// Extracted modules
import { ChatViewContext, enforceSessionMessageLimit } from './chatViewContext';
import { getWebviewHtml } from './webview/getWebviewHtml';
import {
    createSession, switchToSession, renameSession, deleteSession,
    sendSessionList, sendActiveSession, pinSession, searchSessions, tagSession,
} from './session/sessionManager';
import {
    handleUserMessage,
    regenerateLastResponse, editAndResubmit, deleteMessage,
    bookmarkMessage, reactToMessage,
    insertCodeAtCursor, applyCodeToFile, newFileWithCode,
    exportCurrentChat, exportAsJson, sendSessionStats,
    handleSlashCommand,
    handleRapidCode,
    sendRecentFiles, insertRecentFile,
    buildWorkspaceTreeAsync,
} from './chat';

// ──────────────────────────────────────────────
// Main provider
// ──────────────────────────────────────────────

export class MercuryChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'mercuryChat.chatView';

    private _view?: vscode.WebviewView;
    private _client: MercuryClient;
    private _router?: ProviderRouter;
    private _storage: ChatStorage;
    private _index: SessionIndex;
    private _currentSession: ChatSession | null = null;
    private _abortController?: AbortController;
    private _activeFileContext?: ActiveFileContext;
    private _lastUserText?: string;
    private _lastUserMode?: string;
    private _lastSendTimestamp = 0;
    private _streamingStateListeners: ((streaming: boolean) => void)[] = [];
    private _streamCompleteListeners: ((title: string) => void)[] = [];
    private _inputDrafts: Map<string, string> = new Map();
    private _streamStartTime?: number;
    private _cachedWorkspaceTree: string = '';
    private _workspaceTreeDirty = true;
    private _fsWatcher?: vscode.FileSystemWatcher;
    private _streamBatchBuffer: string = '';
    private _streamBatchTimer?: NodeJS.Timeout;
    private _streamIndicatorTimer?: NodeJS.Timeout;
    private _streamIndicatorVisible = false;
    private _pendingToolConfirm?: { resolve: (approved: boolean) => void };
    private readonly _debouncedSearchSessions: (query: string) => void;

    /** Register a callback for streaming state changes */
    public onStreamingStateChanged(listener: (streaming: boolean) => void): void {
        this._streamingStateListeners.push(listener);
    }

    /** Register a callback for stream completion */
    public onStreamComplete(listener: (title: string) => void): void {
        this._streamCompleteListeners.push(listener);
    }

    /** Check if the webview is visible */
    public isWebviewVisible(): boolean {
        return this._view?.visible ?? false;
    }

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _globalStoragePath: string,
        client: MercuryClient,
        router?: ProviderRouter,
    ) {
        this._client = client;
        this._router = router;
        this._storage = new ChatStorage(_globalStoragePath);
        this._index = this._storage.loadIndex();

        if (this._index.activeSessionId) {
            this._currentSession = this._storage.loadSession(this._index.activeSessionId);
        }

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspaceRoot) {
            this._fsWatcher = vscode.workspace.createFileSystemWatcher('**/*');
            this._fsWatcher.onDidCreate((uri) => { this._workspaceTreeDirty = true; toolResultCache.invalidatePath(uri.fsPath); });
            this._fsWatcher.onDidDelete((uri) => { this._workspaceTreeDirty = true; toolResultCache.invalidatePath(uri.fsPath); });
            this._fsWatcher.onDidChange?.((uri) => { toolResultCache.invalidatePath(uri.fsPath); });
            this._workspaceTreeDirty = true;
            buildWorkspaceTreeAsync().then((tree) => {
                this._cachedWorkspaceTree = tree;
                this._workspaceTreeDirty = false;
            });
        }

        this._debouncedSearchSessions = debounce((query: string) => {
            searchSessions(this._createContext(), query);
        }, 120);
    }

    public dispose(): void {
        if (this._streamBatchTimer) { clearTimeout(this._streamBatchTimer); this._streamBatchTimer = undefined; }
        if (this._streamIndicatorTimer) { clearTimeout(this._streamIndicatorTimer); this._streamIndicatorTimer = undefined; }
        this._fsWatcher?.dispose();
        this._storage.dispose();
    }

    // ──── Context bridge ────

    /** Create a live proxy-backed context — reads/writes go directly to provider fields */
    private _createContext(): ChatViewContext {
        const fieldMap: Record<string, string> = {
            view: '_view',
            currentSession: '_currentSession',
            index: '_index',
            storage: '_storage',
            client: '_client',
            router: '_router',
            extensionUri: '_extensionUri',
            abortController: '_abortController',
            activeFileContext: '_activeFileContext',
            streamBatchBuffer: '_streamBatchBuffer',
            streamBatchTimer: '_streamBatchTimer',
            inputDrafts: '_inputDrafts',
            lastUserText: '_lastUserText',
            lastUserMode: '_lastUserMode',
            streamingStateListeners: '_streamingStateListeners',
            streamCompleteListeners: '_streamCompleteListeners',
            streamIndicatorVisible: '_streamIndicatorVisible',
            streamIndicatorTimer: '_streamIndicatorTimer',
            streamStartTime: '_streamStartTime',
            lastSendTimestamp: '_lastSendTimestamp',
            cachedWorkspaceTree: '_cachedWorkspaceTree',
            workspaceTreeDirty: '_workspaceTreeDirty',
            pendingToolConfirm: '_pendingToolConfirm',
        };
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        return new Proxy({} as ChatViewContext, {
            get(_target, prop: string) {
                const field = fieldMap[prop];
                return field ? (self as any)[field] : undefined;
            },
            set(_target, prop: string, value) {
                const field = fieldMap[prop];
                if (field) { (self as any)[field] = value; }
                return true;
            },
        });
    }

    /** Execute a module function with live context */
    private _withContext<T>(fn: (ctx: ChatViewContext) => T): T {
        return fn(this._createContext());
    }

    /** Execute an async module function with live context */
    private async _withContextAsync<T>(fn: (ctx: ChatViewContext) => Promise<T>): Promise<T> {
        return fn(this._createContext());
    }

    // ──── Public API (called from extension.ts commands) ────

    public newChat(): void {
        this._withContext(ctx => {
            const session = createSession(ctx);
            switchToSession(ctx, session.id);
        });
    }

    public clearCurrentChat(): void {
        if (this._currentSession) {
            this._currentSession.messages = [];
            this._currentSession.updatedAt = Date.now();
            this._storage.saveSession(this._currentSession);
        }
        this._view?.webview.postMessage({ type: 'clearChat' });
    }

    public sendToInput(text: string): void {
        this._view?.webview.postMessage({ type: 'insertText', text });
        this._view?.show?.(true);
    }

    public sendAndSubmit(text: string, mode: string): void {
        this._view?.show?.(true);
        setTimeout(() => {
            this._withContextAsync(ctx => handleUserMessage(ctx, text, mode));
        }, 200);
    }

    public updateActiveFile(ctx: ActiveFileContext | undefined): void {
        this._activeFileContext = ctx;
        this._view?.webview.postMessage({ type: 'activeFileContext', context: ctx });
    }

    public clearAllSessions(): void {
        for (const s of this._index.sessions) {
            this._storage.deleteSession(s.id);
        }
        this._index.sessions = [];
        this._index.activeSessionId = null;
        this._storage.saveIndex(this._index);
        this._currentSession = null;
        this.newChat();
    }

    public undoLastMessage(): void {
        if (!this._currentSession) { return; }
        const msgs = this._currentSession.messages;
        while (msgs.length > 0) {
            const last = msgs[msgs.length - 1];
            msgs.pop();
            if (last.role === 'user') { break; }
        }
        this._currentSession.updatedAt = Date.now();
        this._storage.saveSession(this._currentSession);
        this._withContext(ctx => sendActiveSession(ctx));
    }

    public async exportCurrentChat(): Promise<void> {
        await this._withContextAsync(ctx => exportCurrentChat(ctx));
    }

    public toggleSidebar(): void {
        this._view?.webview.postMessage({ type: 'toggleSidebar' });
    }

    public duplicateCurrentSession(): void {
        if (!this._currentSession) { return; }
        this._withContext(ctx => {
            const newSession = createSession(ctx);
            newSession.title = this._currentSession!.title + ' (copy)';
            newSession.messages = JSON.parse(JSON.stringify(this._currentSession!.messages));
            newSession.systemPrompt = this._currentSession!.systemPrompt;
            ctx.storage.saveSession(newSession);
            const entry = ctx.index.sessions.find(s => s.id === newSession.id);
            if (entry) { entry.title = newSession.title; ctx.storage.saveIndex(ctx.index); }
            switchToSession(ctx, newSession.id);
        });
    }

    public setCompactMode(compact: boolean): void {
        this._view?.webview.postMessage({ type: 'setCompactMode', compact });
    }

    public setAccentColor(color: string): void {
        this._view?.webview.postMessage({ type: 'setAccentColor', color });
    }

    public showShortcutsOverlay(): void {
        this._view?.webview.postMessage({ type: 'showShortcuts' });
    }

    public showChatSearch(): void {
        this._view?.webview.postMessage({ type: 'showChatSearch' });
    }

    /** Feature #1 — stop generation */
    public stopGeneration(): void {
        this._abortController?.abort();
    }

    /** Regenerate the last assistant response */
    public async regenerateLastResponse(): Promise<void> {
        await this._withContextAsync(ctx =>
            regenerateLastResponse(ctx, (text, mode) => handleUserMessage(ctx, text, mode)),
        );
    }

    // ──── Webview lifecycle ────

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = getWebviewHtml(webviewView.webview, this._extensionUri);

        webviewView.webview.onDidReceiveMessage(async (msg) => {
            try {
            switch (msg.type) {
                case 'ready':
                    this._withContext(ctx => sendSessionList(ctx));
                    if (!this._currentSession) {
                        if (this._index.sessions.length === 0) {
                            this.newChat();
                        } else {
                            this._withContext(ctx => switchToSession(ctx, this._index.sessions[0].id));
                        }
                    } else {
                        this._withContext(ctx => sendActiveSession(ctx));
                    }
                    break;
                case 'sendMessage':
                    await this._withContextAsync(ctx => handleUserMessage(ctx, msg.text, msg.mode));
                    break;
                case 'stopGeneration':
                    this._abortController?.abort();
                    break;
                case 'newChat':
                    this.newChat();
                    break;
                case 'switchSession':
                    this._withContext(ctx => switchToSession(ctx, msg.id));
                    break;
                case 'renameSession':
                    this._withContext(ctx => renameSession(ctx, msg.id, msg.title));
                    break;
                case 'deleteSession':
                    this._withContext(ctx => deleteSession(ctx, msg.id));
                    break;
                case 'toolConfirmResult':
                    if (this._pendingToolConfirm) {
                        this._pendingToolConfirm.resolve(msg.approved);
                        this._pendingToolConfirm = undefined;
                    }
                    break;
                case 'setSessionSystemPrompt':
                    if (this._currentSession) {
                        this._currentSession.systemPrompt = msg.prompt || undefined;
                        this._storage.saveSession(this._currentSession);
                    }
                    break;
                case 'changeModel':
                    await vscode.workspace.getConfiguration('mercuryChat')
                        .update('model', msg.model, vscode.ConfigurationTarget.Global);
                    this._view?.webview.postMessage({ type: 'modelChanged', model: msg.model });
                    break;
                case 'exportChat':
                    await this._withContextAsync(ctx => exportCurrentChat(ctx));
                    break;
                case 'insertAtCursor':
                    insertCodeAtCursor(msg.code);
                    break;
                case 'applyToFile':
                    await applyCodeToFile(msg.code, msg.language);
                    break;
                case 'newFileWithCode':
                    await newFileWithCode(msg.code, msg.language);
                    break;
                case 'regenerate':
                    await this.regenerateLastResponse();
                    break;
                case 'editAndResubmit':
                    await this._withContextAsync(ctx =>
                        editAndResubmit(ctx, msg.messageIndex, msg.newText, msg.mode,
                            (text, mode) => handleUserMessage(ctx, text, mode)),
                    );
                    break;
                case 'deleteMessage':
                    this._withContext(ctx => deleteMessage(ctx, msg.messageIndex));
                    break;
                case 'undoLast':
                    this.undoLastMessage();
                    break;
                case 'clearAllSessions':
                    this.clearAllSessions();
                    break;
                case 'retryAfterError':
                    if (this._lastUserText) {
                        await this._withContextAsync(ctx =>
                            handleUserMessage(ctx, this._lastUserText!, this._lastUserMode),
                        );
                    }
                    break;
                case 'resumeFromPartial':
                    if (msg.partial && this._lastUserText) {
                        if (this._currentSession) {
                            this._currentSession.messages.push({ role: 'assistant', content: msg.partial });
                            this._withContext(ctx => enforceSessionMessageLimit(ctx));
                        }
                        await this._withContextAsync(ctx =>
                            handleUserMessage(ctx, 'Continue from where you left off. Do not repeat what was already said.', this._lastUserMode),
                        );
                    }
                    break;
                case 'pinSession':
                    this._withContext(ctx => pinSession(ctx, msg.id, msg.pinned));
                    break;
                case 'searchSessions':
                    this._debouncedSearchSessions(msg.query || '');
                    break;
                case 'getRecentFiles':
                    this._withContext(ctx => sendRecentFiles(ctx));
                    break;
                case 'insertRecentFile':
                    this._withContext(ctx => insertRecentFile(ctx, msg.path));
                    break;
                case 'slashCommand':
                    await this._withContextAsync(async ctx => {
                        const rapidCodeFn = await handleRapidCode(ctx);
                        await handleSlashCommand(
                            msg.command, msg.args || '', msg.mode || 'code',
                            (text, mode) => handleUserMessage(ctx, text, mode),
                            rapidCodeFn,
                            () => this.clearCurrentChat(),
                        );
                    });
                    break;
                case 'duplicateSession':
                    this.duplicateCurrentSession();
                    break;
                case 'saveInputDraft':
                    if (this._currentSession) {
                        this._inputDrafts.set(this._currentSession.id, msg.text || '');
                    }
                    break;
                case 'bookmarkMessage':
                    this._withContext(ctx => bookmarkMessage(ctx, msg.messageIndex, msg.bookmarked));
                    break;
                case 'reactionMessage':
                    this._withContext(ctx => reactToMessage(ctx, msg.messageIndex, msg.reaction));
                    break;
                case 'tagSession':
                    this._withContext(ctx => tagSession(ctx, msg.id, msg.tag));
                    break;
                case 'exportAsJson':
                    await this._withContextAsync(ctx => exportAsJson(ctx));
                    break;
                case 'getSessionStats':
                    this._withContext(ctx => sendSessionStats(ctx));
                    break;
                case 'setReasoningEffort':
                    if (msg.effort && this._client) {
                        this._client.updateConfig({ reasoningEffort: msg.effort });
                    }
                    break;
                case 'setTemperature':
                    if (msg.temperature !== undefined && this._client) {
                        this._client.updateConfig({ temperature: msg.temperature });
                    }
                    break;
                case 'setMaxTokens':
                    if (msg.maxTokens !== undefined && this._client) {
                        this._client.updateConfig({ maxTokens: msg.maxTokens });
                    }
                    break;
                default:
                    console.warn('[Mercury] Unknown webview message type:', msg.type);
                    break;
            }
            } catch (err) {
                console.error('[Mercury] Error handling webview message:', msg.type, err);
            }
        });
    }
}
