/**
 * recentFiles.ts — Recent files list and insertion
 * Extracted from chatViewProvider.ts
 */

import * as vscode from 'vscode';
import { ChatViewContext, postMessage } from '../chatViewContext';

export function sendRecentFiles(ctx: ChatViewContext): void {
    const recentFiles: string[] = [];
    for (const doc of vscode.workspace.textDocuments) {
        if (doc.uri.scheme === 'file' && !doc.isUntitled) {
            recentFiles.push(vscode.workspace.asRelativePath(doc.uri));
        }
    }
    postMessage(ctx, {
        type: 'recentFiles',
        files: recentFiles.slice(0, 20),
    });
}

export function insertRecentFile(ctx: ChatViewContext, filePath: string): void {
    postMessage(ctx, { type: 'insertText', text: `@file(${filePath})` });
    ctx.view?.show?.(true);
}
