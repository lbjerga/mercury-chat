/**
 * slashCommands.ts — Slash command handler
 * Extracted from chatViewProvider.ts
 */

import * as vscode from 'vscode';

export async function handleSlashCommand(
    command: string,
    text: string,
    mode: string | undefined,
    handleUserMessage: (text: string, mode?: string) => Promise<void>,
    handleRapidCode: (task: string) => Promise<void>,
    clearChat: () => void,
): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const sel = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
    const lang = editor?.document.languageId || '';
    switch (command) {
        case 'explain':
            await handleUserMessage(sel ? `Explain this code:\n\`\`\`${lang}\n${sel}\n\`\`\`` : `Explain: ${text}`, 'ask');
            break;
        case 'fix':
            await handleUserMessage(sel ? `Fix the bugs in this code:\n\`\`\`${lang}\n${sel}\n\`\`\`` : `Fix: ${text}`, 'code');
            break;
        case 'test':
            await handleUserMessage(sel ? `Generate tests for:\n\`\`\`${lang}\n${sel}\n\`\`\`` : `Generate tests for: ${text}`, 'code');
            break;
        case 'doc':
            await handleUserMessage(sel ? `Generate documentation for:\n\`\`\`${lang}\n${sel}\n\`\`\`` : `Generate docs for: ${text}`, 'ask');
            break;
        case 'rapid':
            await handleRapidCode(text);
            break;
        case 'commit':
            vscode.commands.executeCommand('mercuryChat.generateCommitMessage');
            break;
        case 'clear':
            clearChat();
            break;
        default:
            await handleUserMessage(`/${command} ${text}`, mode);
    }
}
