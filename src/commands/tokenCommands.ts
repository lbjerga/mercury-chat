/**
 * tokenCommands.ts — Token usage, provider health, and provider switching
 */
import * as vscode from 'vscode';
import { tokenTracker } from '../tokenTracker';
import { showOutputChannel, logInfo } from '../outputChannel';
import { ProviderRouter, ProviderId } from '../providers';

export function registerTokenCommands(
    context: vscode.ExtensionContext,
    router: ProviderRouter,
    statusBarItem: vscode.StatusBarItem,
): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand('mercuryChat.showTokenUsage', () => {
            const report = tokenTracker.formatDetailedReport();
            logInfo(report);
            showOutputChannel();
            const stats = tokenTracker.getSessionStats();
            vscode.window.showInformationMessage(
                `Mercury Session: ${stats.totalRequests} requests · ${stats.totalBestEstimate.toLocaleString()} tokens · $${stats.totalCostUsd.toFixed(4)}`,
            );
        }),

        vscode.commands.registerCommand('mercuryChat.resetTokenStats', () => {
            tokenTracker.resetSession();
            context.globalState.update('mercuryTokenStats', undefined);
            statusBarItem.text = '$(sparkle) Mercury';
            statusBarItem.tooltip = 'Mercury Chat — Idle';
            statusBarItem.command = 'mercuryChat.newChat';
            vscode.window.showInformationMessage('Mercury token stats reset.');
        }),

        vscode.commands.registerCommand('mercuryChat.showProviderHealth', () => {
            const status = router.getStatus();
            const lines = ['# Provider Health\n'];
            for (const p of status.providers) {
                const icon = p.active ? '🟢' : p.breakerOpen ? '🔴' : p.available ? '⚪' : '⚫';
                const state = p.breakerOpen ? 'CIRCUIT OPEN' : p.available ? 'available' : 'unavailable';
                lines.push(`${icon} **${p.label}** — ${state} (${p.failures} failures)${p.active ? ' ← active' : ''}`);
            }
            lines.push(`\nRoute order: ${status.routeOrder.join(' → ')}`);
            const msg = lines.join('\n');
            logInfo(msg);
            showOutputChannel();
            vscode.window.showInformationMessage(
                `Providers: ${status.providers.filter(p => p.available).length}/${status.providers.length} available · Active: ${status.activeProvider ?? 'none'}`,
            );
        }),

        vscode.commands.registerCommand('mercuryChat.switchProvider', async () => {
            const status = router.getStatus();
            const items = status.providers.map(p => ({
                label: `${p.active ? '$(check) ' : ''}${p.label}`,
                description: p.breakerOpen ? 'circuit open' : p.available ? 'available' : 'unavailable',
                providerId: p.id,
            }));
            const pick = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select primary provider (others remain as fallbacks)',
            });
            if (pick) {
                const newOrder = [pick.providerId, ...status.routeOrder.filter(id => id !== pick.providerId)] as ProviderId[];
                router.updateRouteOrder(newOrder);
                logInfo(`[Router] Route order updated: ${newOrder.join(' → ')}`);
                vscode.window.showInformationMessage(`Primary provider set to ${pick.label.replace('$(check) ', '')}`);
            }
        }),
    ];
}
