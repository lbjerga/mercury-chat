/**
 * editorContext.ts — Track active editor and send context to webview
 */
import * as vscode from 'vscode';
import { MercuryChatViewProvider } from './chatViewProvider';

const EDITOR_CONTEXT_DEBOUNCE_MS = 300;

export function registerEditorContextTracking(
    chatProvider: MercuryChatViewProvider,
): vscode.Disposable[] {
    let editorContextTimer: NodeJS.Timeout | undefined;

    const sendEditorContext = (editor?: vscode.TextEditor) => {
        if (!editor) {
            chatProvider.updateActiveFile(undefined);
            return;
        }
        const doc = editor.document;
        const selection = editor.selection;
        const diagnostics = vscode.languages.getDiagnostics(doc.uri);
        const errors = diagnostics
            .filter(d => d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning)
            .slice(0, 10)
            .map(d => ({
                line: d.range.start.line + 1,
                severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error' as const : 'warning' as const,
                message: d.message,
            }));
        chatProvider.updateActiveFile({
            path: vscode.workspace.asRelativePath(doc.uri),
            language: doc.languageId,
            lineCount: doc.lineCount,
            selection: selection.isEmpty ? undefined : {
                text: doc.getText(selection),
                startLine: selection.start.line + 1,
                endLine: selection.end.line + 1,
            },
            diagnostics: errors,
        });
    };

    const debouncedSendEditorContext = (editor?: vscode.TextEditor) => {
        if (editorContextTimer) { clearTimeout(editorContextTimer); }
        editorContextTimer = setTimeout(() => sendEditorContext(editor), EDITOR_CONTEXT_DEBOUNCE_MS);
    };

    // Initial send
    if (vscode.window.activeTextEditor) {
        sendEditorContext(vscode.window.activeTextEditor);
    }

    // Tool result cache invalidation is handled by the FileSystemWatcher in chatViewProvider.ts

    return [
        vscode.window.onDidChangeActiveTextEditor(sendEditorContext),
        vscode.window.onDidChangeTextEditorSelection(e => debouncedSendEditorContext(e.textEditor)),
        vscode.languages.onDidChangeDiagnostics(() => {
            const editor = vscode.window.activeTextEditor;
            if (editor) { debouncedSendEditorContext(editor); }
        }),
    ];
}
