/**
 * codeBlockActions.ts — Insert, apply, and new-file code block actions
 * Extracted from chatViewProvider.ts
 */

import * as vscode from 'vscode';

export function insertCodeAtCursor(code: string): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor. Open a file first.');
        return;
    }
    editor.edit(editBuilder => {
        editBuilder.insert(editor.selection.active, code);
    });
}

export async function applyCodeToFile(code: string, language?: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        await newFileWithCode(code, language);
        return;
    }
    await editor.edit(editBuilder => {
        if (editor.selection.isEmpty) {
            editBuilder.insert(editor.selection.active, code);
        } else {
            editBuilder.replace(editor.selection, code);
        }
    });
    vscode.window.showInformationMessage('Code applied to active editor.');
}

export async function newFileWithCode(code: string, language?: string): Promise<void> {
    const langMap: Record<string, string> = {
        ts: 'typescript', typescript: 'typescript', js: 'javascript', javascript: 'javascript',
        py: 'python', python: 'python', java: 'java', cpp: 'cpp', c: 'c', cs: 'csharp',
        csharp: 'csharp', go: 'go', rust: 'rust', rs: 'rust', rb: 'ruby', ruby: 'ruby',
        html: 'html', css: 'css', json: 'json', yaml: 'yaml', yml: 'yaml',
        sh: 'shellscript', bash: 'shellscript', sql: 'sql', md: 'markdown', markdown: 'markdown',
        xml: 'xml', php: 'php', swift: 'swift', kt: 'kotlin', kotlin: 'kotlin',
        dart: 'dart', r: 'r', lua: 'lua', scala: 'scala', powershell: 'powershell', ps1: 'powershell',
    };
    const vsLang = (language && langMap[language.toLowerCase()]) || language || 'plaintext';
    const doc = await vscode.workspace.openTextDocument({ content: code, language: vsLang });
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Active });
}
