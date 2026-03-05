/**
 * customInstructions.ts — Read workspace-level custom instructions
 *
 * Improvement #4: Support .mercury-instructions.md or .github/copilot-instructions.md
 * for project-specific system prompt additions.
 *
 * Uses a file watcher for instant cache invalidation instead of TTL polling.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { invalidateFrozenPrompt } from './promptCache';

const INSTRUCTION_FILES = [
    '.mercury-instructions.md',
    '.mercury-instructions',
    '.github/mercury-instructions.md',
    '.github/copilot-instructions.md',
];

/** Cache to avoid re-reading on every request */
let cachedInstructions: string | undefined;
let _watcherInitialized = false;
const _instructionWatchers: vscode.FileSystemWatcher[] = [];

/** Set up file watchers for instant cache invalidation */
function _initWatchers(): void {
    if (_watcherInitialized) { return; }
    _watcherInitialized = true;

    for (const file of INSTRUCTION_FILES) {
        const watcher = vscode.workspace.createFileSystemWatcher(`**/${file}`);
        watcher.onDidChange(() => { cachedInstructions = undefined; invalidateFrozenPrompt(); });
        watcher.onDidCreate(() => { cachedInstructions = undefined; invalidateFrozenPrompt(); });
        watcher.onDidDelete(() => { cachedInstructions = undefined; invalidateFrozenPrompt(); });
        _instructionWatchers.push(watcher);
    }
}

/** Dispose file watchers created by custom instructions */
export function disposeInstructionWatchers(): void {
    for (const w of _instructionWatchers) { w.dispose(); }
    _instructionWatchers.length = 0;
}

/**
 * Read custom instructions from workspace root.
 * Checks multiple file paths in priority order.
 * Returns empty string if no instructions file found.
 */
export function getCustomInstructions(): string {
    _initWatchers();
    if (cachedInstructions !== undefined) {
        return cachedInstructions;
    }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        cachedInstructions = '';
        return '';
    }

    const root = folders[0].uri.fsPath;

    for (const file of INSTRUCTION_FILES) {
        const fullPath = path.join(root, file);
        try {
            if (fs.existsSync(fullPath)) {
                const content = fs.readFileSync(fullPath, 'utf-8').trim();
                if (content) {
                    cachedInstructions = content;
                    return content;
                }
            }
        } catch {
            // Skip unreadable files
        }
    }

    cachedInstructions = '';
    return '';
}

/** Clear the custom instructions cache (e.g., on file change) */
export function clearCustomInstructionsCache(): void {
    cachedInstructions = undefined;
}
