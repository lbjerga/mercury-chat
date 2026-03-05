/**
 * configWatcher.ts — React to mercuryChat.* configuration changes
 */
import * as vscode from 'vscode';
import { MercuryClient } from './mercuryClient';
import { MercuryChatViewProvider } from './chatViewProvider';
import { ProviderRouter, ProviderId } from './providers';
import { logger } from './utils/logger';

export function registerConfigWatcher(
    client: MercuryClient,
    router: ProviderRouter,
    chatProvider: MercuryChatViewProvider,
): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('mercuryChat')) { return; }

        const updated = vscode.workspace.getConfiguration('mercuryChat');

        client.updateConfig({
            apiKey: updated.get<string>('apiKey', ''),
            baseUrl: updated.get<string>('apiBaseUrl', 'https://api.inceptionlabs.ai/v1'),
            model: updated.get<string>('model', 'mercury-2'),
            temperature: updated.get<number>('temperature', 0.6),
            maxTokens: updated.get<number>('maxTokens', 32768),
        });

        // Update provider router settings
        router.updateRouteOrder(
            updated.get<ProviderId[]>('routeOrder', ['copilot', 'openrouter', 'ollama', 'mercury']),
        );

        const openRouterProvider = router.getProvider('openrouter');
        if (openRouterProvider) {
            openRouterProvider.updateConfig({
                apiKey: updated.get<string>('openRouterApiKey', ''),
                model: updated.get<string>('openRouterModel', 'google/gemini-2.0-flash-001'),
                timeout: updated.get<number>('openRouterTimeout', 60000),
            });
        }

        const ollamaProvider = router.getProvider('ollama');
        if (ollamaProvider) {
            ollamaProvider.updateConfig({
                baseUrl: updated.get<string>('ollamaEndpoint', 'http://localhost:11434/v1'),
                model: updated.get<string>('ollamaModel', 'llama3.1'),
                timeout: updated.get<number>('ollamaTimeout', 120000),
            });
        }

        const copilotProvider = router.getProvider('copilot');
        if (copilotProvider) {
            copilotProvider.updateConfig({
                preferredFamily: updated.get<string>('copilotModelFamily', 'gpt-4o'),
            });
        }

        // Only reset breakers when provider-related settings change
        const providerKeys = ['routeOrder', 'apiKey', 'openRouterApiKey', 'openRouterModel', 'ollamaEndpoint', 'ollamaModel', 'copilotModelFamily'];
        if (providerKeys.some(key => e.affectsConfiguration(`mercuryChat.${key}`))) {
            router.resetAllBreakers();
        }

        chatProvider.setAccentColor(updated.get<string>('accentColor', '#7c6bf5'));
        chatProvider.setCompactMode(updated.get<boolean>('compactMode', false));

        // Sync logger level
        logger.syncLevelFromConfig();
    });
}
