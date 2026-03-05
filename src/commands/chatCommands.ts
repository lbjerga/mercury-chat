/**
 * chatCommands.ts — Simple chat commands (showOutputChannel, setApiKey, clearHistory, newChat)
 */
import * as vscode from 'vscode';
import { MercuryChatViewProvider } from '../chatViewProvider';
import { showOutputChannel } from '../outputChannel';

export function registerChatCommands(
    chatProvider: MercuryChatViewProvider,
): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand('mercuryChat.showOutputChannel', () => {
            showOutputChannel();
        }),

        vscode.commands.registerCommand('mercuryChat.setApiKey', async () => {
            const key = await vscode.window.showInputBox({
                prompt: 'Enter your Inception Mercury 2 API key',
                password: true,
                placeHolder: 'sk_...',
                ignoreFocusOut: true,
            });
            if (key) {
                await vscode.workspace
                    .getConfiguration('mercuryChat')
                    .update('apiKey', key, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage('Mercury API key saved!');
            }
        }),

        vscode.commands.registerCommand('mercuryChat.clearHistory', () => {
            chatProvider.clearCurrentChat();
            vscode.window.showInformationMessage('Mercury Chat history cleared.');
        }),

        vscode.commands.registerCommand('mercuryChat.newChat', () => {
            chatProvider.newChat();
        }),
    ];
}
