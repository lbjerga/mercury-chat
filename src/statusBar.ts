/**
 * statusBar.ts — Status bar items: main Mercury indicator + reasoning effort
 */
import * as vscode from 'vscode';
import { MercuryChatViewProvider } from './chatViewProvider';
import { ProviderRouter } from './providers';
import { tokenTracker } from './tokenTracker';

export interface StatusBarItems {
    main: vscode.StatusBarItem;
    effort: vscode.StatusBarItem;
    disposables: vscode.Disposable[];
}

export function createStatusBar(
    context: vscode.ExtensionContext,
    chatProvider: MercuryChatViewProvider,
    router: ProviderRouter,
): StatusBarItems {
    const disposables: vscode.Disposable[] = [];

    // ─── Main status bar item ───
    const main = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    main.text = '$(sparkle) Mercury';
    main.tooltip = 'Mercury Chat — Idle';
    main.command = 'mercuryChat.newChat';
    main.show();
    disposables.push(main);

    // ─── Reasoning effort indicator ───
    const effort = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
    effort.command = 'mercuryChat.cycleReasoningEffort';
    const updateEffort = () => {
        const cfg = vscode.workspace.getConfiguration('mercuryChat');
        const e = cfg.get<string>('reasoningEffort', 'medium');
        const icons: Record<string, string> = { instant: '⚡', low: '🔵', medium: '🟡', high: '🔴' };
        effort.text = `${icons[e] || '🟡'} ${e}`;
        effort.tooltip = 'Mercury reasoning effort (click to cycle)';
    };
    updateEffort();
    effort.show();
    disposables.push(effort);

    // ─── Cycle reasoning effort command ───
    disposables.push(
        vscode.commands.registerCommand('mercuryChat.cycleReasoningEffort', async () => {
            const levels = ['instant', 'low', 'medium', 'high'];
            const cfg = vscode.workspace.getConfiguration('mercuryChat');
            const current = cfg.get<string>('reasoningEffort', 'medium');
            const idx = levels.indexOf(current);
            const next = levels[(idx + 1) % levels.length];
            await cfg.update('reasoningEffort', next, vscode.ConfigurationTarget.Global);
            updateEffort();
            vscode.window.showInformationMessage(`Mercury reasoning effort: ${next}`);
        }),
    );

    // ─── Update effort on config change ───
    disposables.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('mercuryChat.reasoningEffort')) {
                updateEffort();
            }
        }),
    );

    // ─── Streaming state callbacks ───
    chatProvider.onStreamingStateChanged((streaming: boolean) => {
        if (streaming) {
            const providerName = router.lastUsedProviderLabel;
            main.text = `$(loading~spin) Mercury via ${providerName}`;
            main.tooltip = `Mercury Chat — Generating via ${providerName}...`;
        } else {
            const stats = tokenTracker.getSessionStats();
            const cost = stats.totalCostUsd;
            const reqs = stats.totalRequests;
            const providerName = router.lastUsedProviderLabel;
            if (reqs > 0) {
                const costStr = cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`;
                main.text = `$(sparkle) Mercury ${costStr} · ${providerName}`;
                main.tooltip = `Mercury Chat — ${reqs} requests · ${stats.totalBestEstimate.toLocaleString()} tokens · ${costStr}\nLast provider: ${providerName}`;
                main.command = 'mercuryChat.showTokenUsage';
            } else {
                main.text = '$(sparkle) Mercury';
                main.tooltip = 'Mercury Chat — Idle';
            }
            context.globalState.update('mercuryTokenStats', tokenTracker.toJSON());
        }
    });

    // ─── Stream-complete notification when panel hidden ───
    chatProvider.onStreamComplete((title: string) => {
        if (!chatProvider.isWebviewVisible()) {
            vscode.window.showInformationMessage(`Mercury finished: ${title}`, 'Open Chat').then(action => {
                if (action === 'Open Chat') {
                    vscode.commands.executeCommand('mercuryChat.chatView.focus');
                }
            });
        }
    });

    return { main, effort, disposables };
}
