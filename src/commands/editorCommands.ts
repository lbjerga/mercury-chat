/**
 * editorCommands.ts — v0.14.0 editor-centric commands
 * (inlinePrompt, sendTerminalOutput, fixDiagnostic)
 */
import * as vscode from 'vscode';
import { MercuryChatViewProvider } from '../chatViewProvider';

export function registerEditorCommands(
    chatProvider: MercuryChatViewProvider,
): vscode.Disposable[] {
    return [
        // #24 Inline Prompt at Cursor (Ctrl+I)
        vscode.commands.registerCommand('mercuryChat.inlinePrompt', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }
            const prompt = await vscode.window.showInputBox({
                prompt: 'Mercury: What do you want to do?',
                placeHolder: 'e.g. "add error handling", "convert to async"',
                ignoreFocusOut: true,
            });
            if (!prompt) { return; }
            const sel = editor.selection;
            const selectedText = sel.isEmpty
                ? editor.document.lineAt(sel.active.line).text
                : editor.document.getText(sel);
            const lang = editor.document.languageId;
            chatProvider.sendAndSubmit(
                `${prompt}\n\n\`\`\`${lang}\n${selectedText}\n\`\`\``,
                'code',
            );
            vscode.commands.executeCommand('mercuryChat.chatView.focus');
        }),

        // #25 Send Terminal Output to Chat
        vscode.commands.registerCommand('mercuryChat.sendTerminalOutput', async () => {
            const terminal = vscode.window.activeTerminal;
            if (!terminal) {
                vscode.window.showWarningMessage('No active terminal.');
                return;
            }
            await vscode.commands.executeCommand('workbench.action.terminal.selectAll');
            await vscode.commands.executeCommand('workbench.action.terminal.copySelection');
            const clipboardText = await vscode.env.clipboard.readText();
            await vscode.commands.executeCommand('workbench.action.terminal.clearSelection');
            if (clipboardText) {
                const truncated = clipboardText.length > 5000
                    ? clipboardText.slice(-5000) + '\n...(showing last 5000 chars)'
                    : clipboardText;
                chatProvider.sendAndSubmit(
                    `Here is my terminal output. Help me understand any errors or issues:\n\n\`\`\`\n${truncated}\n\`\`\``,
                    'ask',
                );
                vscode.commands.executeCommand('mercuryChat.chatView.focus');
            }
        }),

        // #26 Fix Diagnostic
        vscode.commands.registerCommand('mercuryChat.fixDiagnostic', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }
            const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
            const errors = diagnostics
                .filter(d => d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning)
                .slice(0, 10);
            if (errors.length === 0) {
                vscode.window.showInformationMessage('No diagnostics found in current file.');
                return;
            }
            const relPath = vscode.workspace.asRelativePath(editor.document.uri);
            const lang = editor.document.languageId;
            const diagText = errors.map(d => {
                const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' : 'WARNING';
                return `Line ${d.range.start.line + 1}: [${sev}] ${d.message}`;
            }).join('\n');

            const firstLine = Math.max(0, errors[0].range.start.line - 5);
            const lastLine = Math.min(editor.document.lineCount - 1, errors[errors.length - 1].range.end.line + 5);
            const codeContext = editor.document.getText(new vscode.Range(firstLine, 0, lastLine, 999));

            chatProvider.sendAndSubmit(
                `Fix these diagnostics in \`${relPath}\`:\n\n${diagText}\n\nRelevant code (lines ${firstLine + 1}–${lastLine + 1}):\n\`\`\`${lang}\n${codeContext}\n\`\`\``,
                'code',
            );
            vscode.commands.executeCommand('mercuryChat.chatView.focus');
        }),
    ];
}
