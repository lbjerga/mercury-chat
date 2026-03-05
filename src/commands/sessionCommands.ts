/**
 * sessionCommands.ts — Session management & misc chat commands
 */
import * as vscode from 'vscode';
import { MercuryChatViewProvider } from '../chatViewProvider';

export function registerSessionCommands(
    chatProvider: MercuryChatViewProvider,
): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand('mercuryChat.clearAllSessions', async () => {
            const answer = await vscode.window.showWarningMessage(
                'Delete ALL chat sessions? This cannot be undone.',
                { modal: true },
                'Delete All',
            );
            if (answer === 'Delete All') {
                chatProvider.clearAllSessions();
                vscode.window.showInformationMessage('All Mercury chat sessions deleted.');
            }
        }),

        vscode.commands.registerCommand('mercuryChat.stopGeneration', () => {
            chatProvider.stopGeneration();
        }),

        vscode.commands.registerCommand('mercuryChat.regenerate', () => {
            chatProvider.regenerateLastResponse();
        }),

        vscode.commands.registerCommand('mercuryChat.viewLearnings', () => {
            const { learningsManager } = require('../learnings');
            vscode.window.showInformationMessage(learningsManager.getSummary());
        }),

        vscode.commands.registerCommand('mercuryChat.clearLearnings', async () => {
            const answer = await vscode.window.showWarningMessage(
                'Clear all Mercury learnings data?', { modal: true }, 'Clear',
            );
            if (answer === 'Clear') {
                const { learningsManager } = require('../learnings');
                learningsManager.clearAll();
                vscode.window.showInformationMessage('Learnings cleared.');
            }
        }),

        vscode.commands.registerCommand('mercuryChat.undoLastMessage', () => {
            chatProvider.undoLastMessage();
        }),

        vscode.commands.registerCommand('mercuryChat.duplicateSession', () => {
            chatProvider.duplicateCurrentSession();
        }),

        vscode.commands.registerCommand('mercuryChat.toggleCompact', async () => {
            const cfg = vscode.workspace.getConfiguration('mercuryChat');
            const current = cfg.get<boolean>('compactMode', false);
            await cfg.update('compactMode', !current, vscode.ConfigurationTarget.Global);
            chatProvider.setCompactMode(!current);
        }),

        vscode.commands.registerCommand('mercuryChat.showShortcuts', () => {
            chatProvider.showShortcutsOverlay();
        }),

        vscode.commands.registerCommand('mercuryChat.searchInChat', () => {
            chatProvider.showChatSearch();
        }),

        vscode.commands.registerCommand('mercuryChat.exportChat', async () => {
            await chatProvider.exportCurrentChat();
        }),

        vscode.commands.registerCommand('mercuryChat.toggleSidebar', () => {
            chatProvider.toggleSidebar();
        }),
    ];
}
