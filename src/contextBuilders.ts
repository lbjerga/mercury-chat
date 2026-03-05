/**
 * contextBuilders.ts — Build context for Mercury chat requests
 *
 * Workspace tree, active editor context, open tabs, message builder, intent detection
 */

import * as vscode from 'vscode';
import { MercuryMessage } from './mercuryClient';
import { getCustomInstructions } from './customInstructions';
import { getGitStatus } from './gitContext';
import { buildFrozenSystemPrompt, buildContextSystemPrompt } from './promptCache';

// ──────────────────────────────────────────────
// Workspace file tree for system prompt (cached with file watcher)
// ──────────────────────────────────────────────

let _workspaceTreeCache: string | undefined;
let _workspaceTreeWatcherInitialized = false;
const _contextWatchers: vscode.FileSystemWatcher[] = [];

function _initWorkspaceTreeWatcher(): void {
    if (_workspaceTreeWatcherInitialized) { return; }
    _workspaceTreeWatcherInitialized = true;
    // Invalidate cache when files/folders are created, deleted, or renamed
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    watcher.onDidCreate(() => { _workspaceTreeCache = undefined; });
    watcher.onDidDelete(() => { _workspaceTreeCache = undefined; });
    _contextWatchers.push(watcher);
    // Note: onDidChange fires on content changes, not needed for tree structure
}

export function getWorkspaceTree(): string {
    _initWorkspaceTreeWatcher();
    if (_workspaceTreeCache !== undefined) { return _workspaceTreeCache; }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { _workspaceTreeCache = ''; return ''; }
    const root = folders[0].uri.fsPath;
    const fsModule = require('fs');
    const pathModule = require('path');
    const skip = new Set(['node_modules', '.git', 'out', 'dist', '.next', '__pycache__', '.venv', 'coverage', '.nyc_output', 'build']);
    const entries: string[] = [];
    const maxEntries = 200;

    function walk(dir: string, prefix: string, depth: number): void {
        if (depth > 5 || entries.length >= maxEntries) { return; }
        try {
            const items = fsModule.readdirSync(dir, { withFileTypes: true }) as Array<{name: string; isDirectory(): boolean}>;
            for (const item of items) {
                if (entries.length >= maxEntries) { break; }
                if (skip.has(item.name) || item.name.startsWith('.')) { continue; }
                const rel = prefix ? `${prefix}/${item.name}` : item.name;
                if (item.isDirectory()) {
                    entries.push(`${rel}/`);
                    walk(pathModule.join(dir, item.name), rel, depth + 1);
                } else {
                    entries.push(rel);
                }
            }
        } catch { /* skip unreadable dirs */ }
    }

    walk(root, '', 0);
    if (entries.length === 0) { _workspaceTreeCache = ''; return ''; }
    _workspaceTreeCache = `\n\nWorkspace file structure:\n\`\`\`\n${entries.join('\n')}\n\`\`\``;
    return _workspaceTreeCache;
}

/** Force-invalidate the workspace tree cache (exported for testing/commands) */
export function invalidateWorkspaceTreeCache(): void {
    _workspaceTreeCache = undefined;
}

// TOOL_INSTRUCTIONS moved to promptCache.ts for shared access

// ──────────────────────────────────────────────
// Diagnostics cache (avoids redundant vscode.languages.getDiagnostics calls)
// ──────────────────────────────────────────────

interface DiagCacheEntry {
    diagnostics: vscode.Diagnostic[];
    timestamp: number;
}

const DIAG_CACHE_TTL_MS = 2_000; // 2 seconds
const MAX_DIAG_ENTRIES = 100;
const _diagCache: Map<string, DiagCacheEntry> = new Map();

/** Get diagnostics for a URI with short TTL caching */
export function getCachedDiagnostics(uri: vscode.Uri): vscode.Diagnostic[] {
    const key = uri.toString();
    const entry = _diagCache.get(key);
    if (entry && (Date.now() - entry.timestamp) < DIAG_CACHE_TTL_MS) {
        return entry.diagnostics;
    }
    const diagnostics = vscode.languages.getDiagnostics(uri);
    _diagCache.set(key, { diagnostics, timestamp: Date.now() });
    // Evict oldest entries if cache exceeds max size
    if (_diagCache.size > MAX_DIAG_ENTRIES) {
        let oldestKey: string | undefined;
        let oldestTime = Infinity;
        for (const [k, v] of _diagCache) {
            if (v.timestamp < oldestTime) { oldestTime = v.timestamp; oldestKey = k; }
        }
        if (oldestKey) { _diagCache.delete(oldestKey); }
    }
    return diagnostics;
}

/** Dispose file watchers created by context builders */
export function disposeContextWatchers(): void {
    for (const w of _contextWatchers) { w.dispose(); }
    _contextWatchers.length = 0;
}

// ──────────────────────────────────────────────
// Active editor context
// ──────────────────────────────────────────────

export function getActiveEditorContext(): string {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return ''; }

    const doc = editor.document;
    const relPath = vscode.workspace.asRelativePath(doc.uri);
    const lang = doc.languageId;
    const parts: string[] = [];

    parts.push(`\n\n**Currently open file:** \`${relPath}\` (${lang}, ${doc.lineCount} lines)`);

    const sel = editor.selection;
    if (!sel.isEmpty) {
        const selectedText = doc.getText(sel);
        if (selectedText.length < 5000) {
            parts.push(`\n**Selected code** (lines ${sel.start.line + 1}–${sel.end.line + 1}):\n\`\`\`${lang}\n${selectedText}\n\`\`\``);
        }
    }

    const diagnostics = getCachedDiagnostics(doc.uri);
    const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);
    const warnings = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Warning);
    if (errors.length > 0 || warnings.length > 0) {
        const diagLines: string[] = [];
        for (const d of [...errors, ...warnings].slice(0, 8)) {
            const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' : 'WARN';
            diagLines.push(`  Line ${d.range.start.line + 1}: [${sev}] ${d.message}`);
        }
        parts.push(`\n**Current diagnostics:**\n${diagLines.join('\n')}`);
    }

    return parts.join('');
}

// ──────────────────────────────────────────────
// Open tabs summary
// ──────────────────────────────────────────────

export function getOpenTabsSummary(): string {
    const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
    const fileTabs = tabs
        .filter(t => t.input instanceof vscode.TabInputText)
        .map(t => {
            const input = t.input as vscode.TabInputText;
            return vscode.workspace.asRelativePath(input.uri);
        })
        .slice(0, 15);

    if (fileTabs.length === 0) { return ''; }
    return `\n\n**Open editor tabs:** ${fileTabs.map(f => `\`${f}\``).join(', ')}`;
}

// ──────────────────────────────────────────────
// Build full message array with context
// ──────────────────────────────────────────────

export async function buildMessages(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    systemPrompt: string,
    commandPrompt: string | undefined,
    autoContext: boolean
): Promise<MercuryMessage[]> {
    const messages: MercuryMessage[] = [];

    // ── Frozen system message (stable prefix for provider-side cache) ──
    // Order: persona → tool instructions → custom instructions
    // This is byte-identical across requests (memoized in promptCache).
    const frozenPrompt = buildFrozenSystemPrompt(systemPrompt);
    messages.push({ role: 'system', content: frozenPrompt });

    // ── Context system message (volatile, per-request) ──
    // Order: command prompt → workspace tree → detected language
    // Sits AFTER the frozen prefix so the prefix cache is preserved.
    const lang = vscode.window.activeTextEditor?.document.languageId;
    const contextPrompt = buildContextSystemPrompt(
        commandPrompt,
        getWorkspaceTree(),
        lang,
    );
    if (contextPrompt) {
        messages.push({ role: 'system', content: contextPrompt });
    }

    // Chat history
    for (const turn of context.history) {
        if (turn instanceof vscode.ChatRequestTurn) {
            messages.push({ role: 'user', content: turn.prompt });
        } else if (turn instanceof vscode.ChatResponseTurn) {
            let responseText = '';
            for (const part of turn.response) {
                if (part instanceof vscode.ChatResponseMarkdownPart) {
                    responseText += part.value.value;
                }
            }
            if (responseText) {
                messages.push({ role: 'assistant', content: responseText });
            }
        }
    }

    // Current message with references
    let userContent = request.prompt;
    const refSections: string[] = [];

    for (const ref of request.references) {
        if (ref.value instanceof vscode.Uri) {
            try {
                const doc = await vscode.workspace.openTextDocument(ref.value);
                const content = doc.getText();
                const relPath = vscode.workspace.asRelativePath(ref.value);
                const lang = doc.languageId;
                if (content.length > 15000) {
                    refSections.push(`**${relPath}** (${doc.lineCount} lines, first 500 lines):\n\`\`\`${lang}\n${content.split('\n').slice(0, 500).join('\n')}\n\`\`\``);
                } else {
                    refSections.push(`**${relPath}**:\n\`\`\`${lang}\n${content}\n\`\`\``);
                }
            } catch {
                refSections.push(`[File: ${vscode.workspace.asRelativePath(ref.value)}] (could not read)`);
            }
        } else if (ref.value instanceof vscode.Location) {
            try {
                const doc = await vscode.workspace.openTextDocument(ref.value.uri);
                const range = ref.value.range;
                const text = doc.getText(range);
                const relPath = vscode.workspace.asRelativePath(ref.value.uri);
                const lang = doc.languageId;
                refSections.push(`**${relPath}** (lines ${range.start.line + 1}–${range.end.line + 1}):\n\`\`\`${lang}\n${text}\n\`\`\``);
            } catch {
                refSections.push(`[File: ${vscode.workspace.asRelativePath(ref.value.uri)}, Lines: ${ref.value.range.start.line + 1}-${ref.value.range.end.line + 1}]`);
            }
        } else if (typeof ref.value === 'string') {
            refSections.push(`\`\`\`\n${ref.value}\n\`\`\``);
        }
    }

    if (refSections.length > 0) {
        userContent += '\n\n---\n**Referenced code:**\n\n' + refSections.join('\n\n');
    }

    if (autoContext && refSections.length === 0) {
        userContent += getActiveEditorContext();
    }

    userContent += getOpenTabsSummary();
    // Append git status after open‑tabs summary
    try {
        const gitStatus = await getGitStatus();
        if (gitStatus) {
            userContent += `\n\n${gitStatus}`;
        }
    } catch { /* git not available */ }

    messages.push({ role: 'user', content: userContent });

    return messages;
}

// ──────────────────────────────────────────────
// Intent detection from diagnostics
// ──────────────────────────────────────────────

export function detectIntent(prompt: string): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return undefined; }

    const diagnostics = getCachedDiagnostics(editor.document.uri);
    const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);

    const lower = prompt.toLowerCase();

    // Short prompt with errors -> fix intent
    if (errors.length > 0 && prompt.length < 30 && !lower.includes('explain')) {
        const hasFixWords = /\b(fix|error|bug|problem|issue|wrong|broken|fail)\b/i.test(lower);
        if (hasFixWords) {
            return 'fix';
        }
    }

    // Keyword based intents
    if (/\bexplain\b/.test(lower)) return 'explain';
    if (/\b(test|unit test|integration test)\b/.test(lower)) return 'test';
    if (/\b(review|code review|audit)\b/.test(lower)) return 'review';
    if (/\b(doc|documentation|readme)\b/.test(lower)) return 'doc';
    if (/\b(refactor|restructure|clean up)\b/.test(lower)) return 'refactor';

    return undefined;
}
