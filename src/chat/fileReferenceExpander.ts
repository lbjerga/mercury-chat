/**
 * fileReferenceExpander.ts — @file, @workspace, @selection, @problems expansion
 * Extracted from chatViewProvider.ts
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export async function expandFileReferences(text: string): Promise<string> {
    let result = text;

    /* @workspace – list top-level files */
    if (/@workspace\b/i.test(result)) {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (root) {
            try {
                const entries = fs.readdirSync(root).slice(0, 40).join(', ');
                result = result.replace(/@workspace\b/gi, `[workspace: ${entries}]`);
            } catch { /* skip */ }
        }
    }

    /* @selection – inline the current editor selection */
    if (/@selection\b/i.test(result)) {
        const editor = vscode.window.activeTextEditor;
        if (editor && !editor.selection.isEmpty) {
            const sel = editor.document.getText(editor.selection);
            const lang = editor.document.languageId;
            result = result.replace(/@selection\b/gi, `\n\`\`\`${lang}\n${sel}\n\`\`\`\n`);
        } else {
            result = result.replace(/@selection\b/gi, '[no selection]');
        }
    }

    /* @problems – inline current diagnostics */
    if (/@problems\b/i.test(result)) {
        const diags = vscode.languages.getDiagnostics();
        const issues: string[] = [];
        for (const [uri, ds] of diags) {
            for (const d of ds) {
                if (d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning) {
                    issues.push(`${vscode.workspace.asRelativePath(uri)}:${d.range.start.line + 1} ${d.severity === 0 ? 'ERROR' : 'WARN'}: ${d.message}`);
                }
            }
            if (issues.length >= 30) { break; }
        }
        result = result.replace(/@problems\b/gi, issues.length ? `\n[Problems:\n${issues.join('\n')}\n]` : '[no problems]');
    }

    /* @file(path) – existing file reference */
    const regex = /@file\(([^)]+)\)/g;
    let match;
    const original = result;
    while ((match = regex.exec(original)) !== null) {
        const filePath = match[1].trim();
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceRoot) { continue; }
        const fullPath = vscode.Uri.joinPath(workspaceRoot, filePath);
        try {
            const stat = await vscode.workspace.fs.stat(fullPath);
            if ((stat.type & vscode.FileType.File) === 0) { continue; }
            const fileBytes = await vscode.workspace.fs.readFile(fullPath);
            const content = new TextDecoder('utf-8').decode(fileBytes);
            const truncated = content.length > 10000 ? content.slice(0, 10000) + '\n... (truncated)' : content;
            const ext = path.extname(filePath).slice(1) || 'text';
            result = result.replace(match[0], `\n\`\`\`${ext} (${filePath})\n${truncated}\n\`\`\`\n`);
        } catch { /* skip unreadable files */ }
    }
    return result;
}
