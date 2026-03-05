import * as vscode from 'vscode';
import { MercuryClient } from './mercuryClient';
import { MercuryChatViewProvider } from './chatViewProvider';
import { createChatHandler } from './chatHandler';
import { disposeContextWatchers } from './contextBuilders';
import { disposeInstructionWatchers } from './customInstructions';
import { resetStickyModel } from './promptCache';
import { registerRapidCodeTool } from './rapidCode';
import { MercuryCodeLensProvider } from './codeLensProvider';
import { logInfo } from './outputChannel';
import { tokenTracker } from './tokenTracker';
import { ProviderRouter, MercuryProvider, OpenRouterProvider, OllamaProvider, CopilotProvider, ProviderId } from './providers';

import {
    registerSelectionCommands,
    registerEditorCommands,
    registerSessionCommands,
    registerTokenCommands,
    registerCodeLensCommands,
    registerChatCommands,
} from './commands';
import { createStatusBar } from './statusBar';
import { registerConfigWatcher } from './configWatcher';
import { registerEditorContextTracking } from './editorContext';

let activeChatProvider: MercuryChatViewProvider | undefined;
let activeRouter: ProviderRouter | undefined;
let extensionContext: vscode.ExtensionContext | undefined;

/**
 * Mercury Chat Extension
 *
 * Registers:
 * 1. @mercury Chat Participant in Copilot Chat (shows alongside Gemini/GPT)
 * 2. Standalone sidebar for session management & browsing
 * Both use the Mercury 2 API — no Copilot credits used.
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('[Mercury Chat] Activating...');

    // ─── Token usage persistence — restore session data ───
    const savedTokenStats = context.globalState.get<{ requests: any[]; sessionStart: number }>('mercuryTokenStats');
    if (savedTokenStats) {
        tokenTracker.fromJSON(savedTokenStats);
    }

    // ─── Initialize Mercury API client ───
    const config = vscode.workspace.getConfiguration('mercuryChat');
    const client = new MercuryClient({
        apiKey: config.get<string>('apiKey', ''),
        baseUrl: config.get<string>('apiBaseUrl', 'https://api.inceptionlabs.ai/v1'),
        model: config.get<string>('model', 'mercury-2'),
        temperature: config.get<number>('temperature', 0.6),
        maxTokens: config.get<number>('maxTokens', 32768),
    });

    // ─── Multi-provider router ───
    const router = new ProviderRouter({
        routeOrder: config.get<ProviderId[]>('routeOrder', ['copilot', 'openrouter', 'ollama', 'mercury']),
    });
    router.register(new MercuryProvider(client));
    router.register(new OpenRouterProvider({
        apiKey: config.get<string>('openRouterApiKey', ''),
        model: config.get<string>('openRouterModel', 'google/gemini-2.0-flash-001'),
    }));
    router.register(new OllamaProvider({
        baseUrl: config.get<string>('ollamaEndpoint', 'http://localhost:11434/v1'),
        model: config.get<string>('ollamaModel', 'llama3.1'),
    }));
    router.register(new CopilotProvider(
        config.get<string>('copilotModelFamily', 'gpt-4o'),
    ));
    logInfo(`[Router] Initialized with route order: ${config.get<ProviderId[]>('routeOrder', ['copilot', 'openrouter', 'ollama', 'mercury']).join(' → ')}`);

    activeRouter = router;
    extensionContext = context;

    // ─── Restore circuit breaker state ───
    const savedBreakerState = context.globalState.get<Record<string, { failures: number; openedAt?: number }>>('mercuryBreakerState');
    if (savedBreakerState) {
        router.restoreBreakers(savedBreakerState);
        logInfo('[Router] Restored circuit breaker state from previous session');
    }

    // ─── Auto-detect available providers ───
    setTimeout(async () => {
        try {
            const ollamaProv = router.getProvider('ollama') as any;
            if (ollamaProv && typeof ollamaProv.probe === 'function') {
                const available = await ollamaProv.probe();
                logInfo(`[Router] Ollama auto-detect: ${available ? 'available' : 'not running'}`);
            }
        } catch { /* ignore probe errors */ }
        try {
            const models = await vscode.lm.selectChatModels({ family: config.get<string>('copilotModelFamily', 'gpt-4o') });
            logInfo(`[Router] Copilot auto-detect: ${models.length > 0 ? models[0].name : 'no models found'}`);
        } catch { /* ignore copilot errors */ }
    }, 2000);

    // ─── 1. Register @mercury Chat Participant ───
    const chatHandler = createChatHandler(client, router);
    const participant = vscode.chat.createChatParticipant('mercury-chat.mercury', chatHandler);
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'mercury-icon.svg');
    context.subscriptions.push(participant);

    // ─── 1b. Rapid Code Language Model Tool ───
    registerRapidCodeTool(context, client);

    // ─── 2. Sidebar webview provider ───
    const chatProvider = new MercuryChatViewProvider(
        context.extensionUri,
        context.globalStorageUri.fsPath,
        client,
        router,
    );
    activeChatProvider = chatProvider;
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            MercuryChatViewProvider.viewType,
            chatProvider,
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
    );
    context.subscriptions.push({ dispose: () => chatProvider.dispose() });

    // ─── 3. CodeLens provider ───
    if (config.get<boolean>('enableCodeLens', true)) {
        const codeLensProvider = new MercuryCodeLensProvider();
        context.subscriptions.push(
            vscode.languages.registerCodeLensProvider(
                [
                    { language: 'typescript' }, { language: 'javascript' },
                    { language: 'typescriptreact' }, { language: 'javascriptreact' },
                    { language: 'python' }, { language: 'java' },
                    { language: 'csharp' }, { language: 'go' },
                    { language: 'rust' }, { language: 'kotlin' },
                ],
                codeLensProvider,
            ),
        );
    }

    // ─── 4. Status bar ───
    const { main: statusBarItem, disposables: statusBarDisposables } = createStatusBar(context, chatProvider, router);
    context.subscriptions.push(...statusBarDisposables);

    // ─── 5. Commands ───
    context.subscriptions.push(
        ...registerCodeLensCommands(),
        ...registerChatCommands(chatProvider),
        ...registerSelectionCommands(chatProvider),
        ...registerEditorCommands(chatProvider),
        ...registerSessionCommands(chatProvider),
        ...registerTokenCommands(context, router, statusBarItem),
    );

    // ─── 6. Config watcher ───
    context.subscriptions.push(registerConfigWatcher(client, router, chatProvider));

    // ─── 7. Editor context tracking ───
    context.subscriptions.push(...registerEditorContextTracking(chatProvider));

    console.log('[Mercury Chat] Activated — use @mercury in Chat or click the Mercury icon in the Activity Bar!');
}

export function deactivate() {
    // Dispose file watchers to prevent leaks
    disposeContextWatchers();
    disposeInstructionWatchers();
    resetStickyModel();

    if (activeRouter && extensionContext) {
        extensionContext.globalState.update('mercuryBreakerState', activeRouter.serializeBreakers());
    }
    activeChatProvider?.dispose();
    activeChatProvider = undefined;
    activeRouter = undefined;
    extensionContext = undefined;
}

