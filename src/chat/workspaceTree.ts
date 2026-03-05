/**
 * workspaceTree.ts — Workspace tree building and caching
 * Extracted from chatViewProvider.ts
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChatViewContext } from '../chatViewContext';

/** Get workspace tree from cache, rebuilding only when dirty */
export function getWorkspaceTree(ctx: ChatViewContext): string {
    if (ctx.workspaceTreeDirty) {
        // Trigger async rebuild (non-blocking), return stale cache for now
        buildWorkspaceTreeAsync().then(tree => {
            ctx.cachedWorkspaceTree = tree;
            ctx.workspaceTreeDirty = false;
        });
    }
    return ctx.cachedWorkspaceTree;
}

/** Build the tree from disk asynchronously */
export async function buildWorkspaceTreeAsync(): Promise<string> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { return ''; }
    const skip = new Set(['node_modules', '.git', 'out', 'dist', '.next', '__pycache__', '.venv', '.vsix']);
    const entries: string[] = [];
    const maxEntries = 80;

    async function walk(dir: string, prefix: string, depth: number): Promise<void> {
        if (depth > 4 || entries.length >= maxEntries) { return; }
        let items: fs.Dirent[];
        try { items = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const item of items) {
            if (skip.has(item.name) || item.name.startsWith('.')) { continue; }
            if (entries.length >= maxEntries) { return; }
            const rel = prefix ? `${prefix}/${item.name}` : item.name;
            if (item.isDirectory()) {
                entries.push(rel + '/');
                await walk(path.join(dir, item.name), rel, depth + 1);
            } else {
                entries.push(rel);
            }
        }
    }
    await walk(root, '', 0);
    return entries.join('\n');
}
