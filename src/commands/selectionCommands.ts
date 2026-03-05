/**
 * selectionCommands.ts — Editor selection-based commands
 * (sendSelection, explain, fix, test, doc, generateCommitMessage)
 */
import * as vscode from 'vscode';
import * as cp from 'child_process';
import { MercuryChatViewProvider } from '../chatViewProvider';

export function registerSelectionCommands(
    chatProvider: MercuryChatViewProvider,
): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand('mercuryChat.sendSelection', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const selection = editor.document.getText(editor.selection);
                if (selection) {
                    const language = editor.document.languageId;
                    chatProvider.sendToInput(`\`\`\`${language}\n${selection}\n\`\`\`\n`);
                }
            }
        }),

        vscode.commands.registerCommand('mercuryChat.explainSelection', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && !editor.selection.isEmpty) {
                const sel = editor.document.getText(editor.selection);
                const lang = editor.document.languageId;
                chatProvider.sendAndSubmit(`Explain this code:\n\`\`\`${lang}\n${sel}\n\`\`\``, 'ask');
            }
        }),

        vscode.commands.registerCommand('mercuryChat.fixSelection', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && !editor.selection.isEmpty) {
                const sel = editor.document.getText(editor.selection);
                const lang = editor.document.languageId;
                chatProvider.sendAndSubmit(`Fix the bugs in this code:\n\`\`\`${lang}\n${sel}\n\`\`\``, 'code');
            }
        }),

        vscode.commands.registerCommand('mercuryChat.testSelection', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && !editor.selection.isEmpty) {
                const sel = editor.document.getText(editor.selection);
                const lang = editor.document.languageId;
                chatProvider.sendAndSubmit(`Generate comprehensive unit tests for this code:\n\`\`\`${lang}\n${sel}\n\`\`\``, 'code');
            }
        }),

        vscode.commands.registerCommand('mercuryChat.docSelection', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && !editor.selection.isEmpty) {
                const sel = editor.document.getText(editor.selection);
                const lang = editor.document.languageId;
                chatProvider.sendAndSubmit(`Generate documentation for this code:\n\`\`\`${lang}\n${sel}\n\`\`\``, 'ask');
            }
        }),

        vscode.commands.registerCommand('mercuryChat.generateCommitMessage', async () => {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                vscode.window.showWarningMessage('No workspace open.');
                return;
            }
            try {
                const diff = await new Promise<string>((resolve, reject) => {
                    cp.exec('git diff --staged', { cwd: workspaceRoot, maxBuffer: 1024 * 500 }, (err, stdout) => {
                        if (err) {
                            cp.exec('git diff', { cwd: workspaceRoot, maxBuffer: 1024 * 500 }, (err2, stdout2) => {
                                if (err2) { reject(err2); } else { resolve(stdout2); }
                            });
                        } else {
                            resolve(stdout);
                        }
                    });
                });
                if (!diff.trim()) {
                    vscode.window.showInformationMessage('No git changes detected.');
                    return;
                }
                const truncatedDiff = diff.length > 8000 ? diff.slice(0, 8000) + '\n...(truncated)' : diff;
                chatProvider.sendAndSubmit(
                    `Generate a concise, conventional commit message (format: type(scope): description) for these changes:\n\`\`\`diff\n${truncatedDiff}\n\`\`\``,
                    'ask',
                );
            } catch {
                vscode.window.showWarningMessage('Failed to get git diff. Is this a git repository?');
            }
        }),
    ];
}
