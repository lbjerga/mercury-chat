/**
 * tools/fileTools.ts — File system tool implementations
 *
 * read_file, write_file, edit_file, list_files
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MercuryClient } from '../mercuryClient';
import { resolvePath } from './helpers';
import { fileCache } from '../fileCache';
import type { ProviderRouter } from '../providers';

// ──────────────────────────────────────────────
// Directory listing cache (avoids redundant recursive walks)
// ──────────────────────────────────────────────

interface DirCacheEntry {
    result: string;
    timestamp: number;
}

const DIR_CACHE_TTL_MS = 5_000;
const _dirCache: Map<string, DirCacheEntry> = new Map();

/** Invalidate the directory listing cache (called after file writes) */
export function invalidateDirCache(): void {
    _dirCache.clear();
}

export async function toolReadFile(
    root: string,
    args: Record<string, unknown>
): Promise<{ content: string; isError: boolean }> {
    const filePath = resolvePath(root, args.path as string);
    if (!fs.existsSync(filePath)) {
        return { content: `File not found: ${args.path}`, isError: true };
    }
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
        return { content: `"${args.path}" is a directory, not a file. Use list_files instead.`, isError: true };
    }
    // #6 Smart file reading: auto-preview large files instead of hard error
    const hasLineRange = typeof args.startLine === 'number' || typeof args.endLine === 'number';
    if (stat.size > 100 * 1024 && !hasLineRange) {
        // Auto-read first 200 lines instead of failing
        const cached = fileCache.get(filePath, stat.mtimeMs);
        const content = cached || fs.readFileSync(filePath, 'utf-8');
        if (!cached) { fileCache.set(filePath, content, stat.mtimeMs); }
        const lines = content.split('\n');
        const previewEnd = Math.min(200, lines.length);
        const slice = lines.slice(0, previewEnd);
        const numbered = slice.map((line, i) => `${i + 1}| ${line}`);
        return {
            content: `File: ${args.path} (${lines.length} lines, ${(stat.size / 1024).toFixed(1)}KB — showing first ${previewEnd} lines)\n${numbered.join('\n')}\n\n... (${lines.length - previewEnd} more lines — use startLine/endLine to read specific sections, or search_files to find specific code)`,
            isError: false,
        };
    }

    const cached = fileCache.get(filePath, stat.mtimeMs);
    const content = cached || fs.readFileSync(filePath, 'utf-8');
    if (!cached) { fileCache.set(filePath, content, stat.mtimeMs); }
    const lines = content.split('\n');

    const startLine = typeof args.startLine === 'number' ? Math.max(1, args.startLine) : 1;
    const endLine = typeof args.endLine === 'number' ? Math.min(lines.length, args.endLine) : lines.length;

    const slice = lines.slice(startLine - 1, endLine);
    const numbered = slice.map((line, i) => `${startLine + i}| ${line}`);
    return {
        content: `File: ${args.path} (lines ${startLine}-${endLine} of ${lines.length})\n${numbered.join('\n')}`,
        isError: false,
    };
}

export async function toolWriteFile(
    root: string,
    args: Record<string, unknown>
): Promise<{ content: string; isError: boolean }> {
    const filePath = resolvePath(root, args.path as string);
    const content = args.content as string;
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const existed = fs.existsSync(filePath);
    fs.writeFileSync(filePath, content, 'utf-8');
    fileCache.invalidate(filePath);
    invalidateDirCache();

    return {
        content: existed
            ? `Updated file: ${args.path} (${content.split('\n').length} lines)`
            : `Created file: ${args.path} (${content.split('\n').length} lines)`,
        isError: false,
    };
}

export async function toolEditFile(
    root: string,
    args: Record<string, unknown>,
    router?: ProviderRouter
): Promise<{ content: string; isError: boolean }> {
    const filePath = resolvePath(root, args.path as string);
    if (!fs.existsSync(filePath)) {
        return { content: `File not found: ${args.path}`, isError: true };
    }
    const oldString = args.oldString as string;
    const newString = args.newString as string;
    const currentContent = fs.readFileSync(filePath, 'utf-8');

    const count = currentContent.split(oldString).length - 1;
    if (count === 0) {
        return { content: `The specified text was not found in ${args.path}. Make sure it matches exactly (including whitespace).`, isError: true };
    }

    // Optionally use the Mercury Edit model
    const config = vscode.workspace.getConfiguration('mercuryChat');
    const useEditModel = config.get<boolean>('useEditModelForEdits', false);
    if (useEditModel) {
        const apiKey = config.get<string>('apiKey', '');
        const baseUrl = config.get<string>('apiBaseUrl', 'https://api.inceptionlabs.ai/v1');
        const editModel = config.get<string>('editModel', 'mercury-edit');
        if (!apiKey) {
            return { content: 'API key not set; cannot call edit model.', isError: true };
        }

        try {
            const updateSnippet = `// ... existing code ...\n${newString}\n// ... existing code ...`;
            let resp: { content: string };
            if (router) {
                resp = await router.applyEdit(currentContent, updateSnippet);
            } else {
                const client = new MercuryClient({ apiKey, baseUrl, model: editModel, temperature: 0.6, maxTokens: 8192 });
                resp = await client.applyEdit(currentContent, updateSnippet);
            }
            const newContent = resp.content;
            if (!newContent) {
                return { content: 'Edit model returned empty content; falling back to local replace.', isError: true };
            }
            fs.writeFileSync(filePath, newContent, 'utf-8');
            fileCache.invalidate(filePath);

            const oldLines = currentContent.split('\n');
            const newLines = newContent.split('\n');
            const diffLines: string[] = [`--- ${args.path}`, `+++ ${args.path}`];
            const maxPreview = 200;
            for (let i = 0; i < Math.max(oldLines.length, newLines.length) && diffLines.length < maxPreview; i++) {
                const o = oldLines[i] ?? '';
                const n = newLines[i] ?? '';
                if (o !== n) {
                    diffLines.push(`-${o}`);
                    diffLines.push(`+${n}`);
                }
            }
            const diffPreview = diffLines.join('\n');
            return { content: `Edited ${args.path}: applied edit via Mercury Edit (Apply Edit endpoint).\n\n${diffPreview}`, isError: false };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            const fallbackContent = currentContent.replace(oldString, newString);
            fs.writeFileSync(filePath, fallbackContent, 'utf-8');
            fileCache.invalidate(filePath);
            return { content: `Edit model failed (${msg}), fell back to local replace in ${args.path}.`, isError: false };
        }
    }

    // Local replace fallback: replace first occurrence only
    const newContent = currentContent.replace(oldString, newString);
    fs.writeFileSync(filePath, newContent, 'utf-8');
    fileCache.invalidate(filePath);

    const oldLines = oldString.split('\n');
    const newLines = newString.split('\n');
    const diffLines: string[] = [`--- ${args.path}`, `+++ ${args.path}`];
    for (const l of oldLines) { diffLines.push('- ' + l); }
    for (const l of newLines) { diffLines.push('+ ' + l); }
    const diffPreview = diffLines.join('\n');

    return {
        content: `Edited ${args.path}: replaced ${count > 1 ? 'first of ' + count + ' occurrences' : '1 occurrence'}\n\n${diffPreview}`,
        isError: false,
    };
}

export async function toolListFiles(
    root: string,
    args: Record<string, unknown>
): Promise<{ content: string; isError: boolean }> {
    const targetPath = args.path as string;
    const dirPath = resolvePath(root, targetPath === '' || targetPath === '.' ? '' : targetPath);

    if (!fs.existsSync(dirPath)) {
        return { content: `Directory not found: ${targetPath}`, isError: true };
    }
    if (!fs.statSync(dirPath).isDirectory()) {
        return { content: `"${targetPath}" is a file, not a directory`, isError: true };
    }

    const recursive = args.recursive === true;
    const cacheKey = `${dirPath}:${recursive}`;
    const cachedEntry = _dirCache.get(cacheKey);
    if (cachedEntry && (Date.now() - cachedEntry.timestamp) < DIR_CACHE_TTL_MS) {
        return { content: cachedEntry.result, isError: false };
    }

    const entries: string[] = [];

    function walk(dir: string, prefix: string): void {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        const skip = new Set(['node_modules', '.git', 'out', 'dist', '.next', '__pycache__', '.venv']);
        for (const item of items) {
            if (skip.has(item.name)) { continue; }
            const rel = prefix ? `${prefix}/${item.name}` : item.name;
            if (item.isDirectory()) {
                entries.push(rel + '/');
                if (recursive) { walk(path.join(dir, item.name), rel); }
            } else {
                entries.push(rel);
            }
        }
    }

    walk(dirPath, '');

    if (entries.length === 0) {
        return { content: `Directory "${targetPath || '.'}" is empty`, isError: false };
    }

    const maxEntries = 200;
    const truncated = entries.length > maxEntries;
    const display = truncated ? entries.slice(0, maxEntries) : entries;

    const result = `Contents of "${targetPath || '.'}" (${entries.length} items${truncated ? `, showing first ${maxEntries}` : ''}):\n${display.join('\n')}`;
    _dirCache.set(cacheKey, { result, timestamp: Date.now() });

    return {
        content: result,
        isError: false,
    };
}
