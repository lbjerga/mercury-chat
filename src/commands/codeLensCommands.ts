/**
 * codeLensCommands.ts — CodeLens action commands (explain, test, fix)
 */
import * as vscode from 'vscode';

export function registerCodeLensCommands(): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand('mercuryChat.codeLensExplain',
            (uri: vscode.Uri, range: vscode.Range) => {
                vscode.commands.executeCommand('workbench.action.chat.open', {
                    query: `@mercury /explain the function at line ${range.start.line + 1}`,
                });
            }),

        vscode.commands.registerCommand('mercuryChat.codeLensTest',
            (uri: vscode.Uri, range: vscode.Range) => {
                vscode.commands.executeCommand('workbench.action.chat.open', {
                    query: `@mercury /test the function at line ${range.start.line + 1}`,
                });
            }),

        vscode.commands.registerCommand('mercuryChat.codeLensFix',
            (uri: vscode.Uri, range: vscode.Range) => {
                vscode.commands.executeCommand('workbench.action.chat.open', {
                    query: `@mercury /fix the function at line ${range.start.line + 1}`,
                });
            }),
    ];
}
