/**
 * tools/vscodeTools.ts — VS Code integration tools
 *
 * get_diagnostics, open_file
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { resolvePath } from './helpers';

/** get_diagnostics — read VS Code problems/errors */
export async function toolGetDiagnostics(
    root: string,
    args: Record<string, unknown>
): Promise<{ content: string; isError: boolean }> {
    const filePath = args.path as string | undefined;

    if (filePath) {
        const resolved = resolvePath(root, filePath);
        const uri = vscode.Uri.file(resolved);
        const diagnostics = vscode.languages.getDiagnostics(uri);
        if (diagnostics.length === 0) {
            return { content: `No diagnostics for ${filePath}`, isError: false };
        }
        const lines = diagnostics.slice(0, 30).map(d => {
            const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR'
                : d.severity === vscode.DiagnosticSeverity.Warning ? 'WARN'
                : d.severity === vscode.DiagnosticSeverity.Information ? 'INFO' : 'HINT';
            return `  Line ${d.range.start.line + 1}: [${sev}] ${d.message}`;
        });
        return {
            content: `Diagnostics for ${filePath} (${diagnostics.length} items):\n${lines.join('\n')}`,
            isError: false,
        };
    }

    // All workspace diagnostics
    const allDiags = vscode.languages.getDiagnostics();
    const entries: string[] = [];
    let totalCount = 0;
    for (const [uri, diags] of allDiags) {
        const errors = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning);
        if (errors.length === 0) { continue; }
        totalCount += errors.length;
        const rel = vscode.workspace.asRelativePath(uri);
        for (const d of errors.slice(0, 5)) {
            const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' : 'WARN';
            entries.push(`${rel}:${d.range.start.line + 1}: [${sev}] ${d.message}`);
        }
        if (entries.length >= 50) { break; }
    }

    if (entries.length === 0) {
        return { content: 'No errors or warnings in the workspace.', isError: false };
    }
    return {
        content: `Workspace diagnostics (${totalCount} issues):\n${entries.join('\n')}`,
        isError: false,
    };
}

/** open_file — open/reveal files in the editor */
export async function toolOpenFile(
    root: string,
    args: Record<string, unknown>
): Promise<{ content: string; isError: boolean }> {
    const filePath = resolvePath(root, args.path as string);
    if (!fs.existsSync(filePath)) {
        return { content: `File not found: ${args.path}`, isError: true };
    }
    const uri = vscode.Uri.file(filePath);
    const line = typeof args.line === 'number' ? Math.max(1, args.line) - 1 : 0;
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Active,
        selection: new vscode.Range(line, 0, line, 0),
        preserveFocus: false,
    });
    return { content: `Opened ${args.path}${line > 0 ? ` at line ${line + 1}` : ''}`, isError: false };
}
