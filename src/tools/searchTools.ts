/**
 * tools/searchTools.ts — Search and symbol-finding tool implementations
 *
 * search_files, find_symbols
 * Uses fileCache to avoid redundant disk reads.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { escapeRegex, matchGlob } from '../utils';
import { resolvePath } from './helpers';
import { fileCache } from '../fileCache';

export async function toolSearchFiles(
    root: string,
    args: Record<string, unknown>
): Promise<{ content: string; isError: boolean }> {
    const pattern = args.pattern as string;
    const searchPath = args.path ? resolvePath(root, args.path as string) : root;
    const filePattern = args.filePattern as string | undefined;

    const results: string[] = [];
    const maxResults = 50;
    let regex: RegExp;

    try {
        regex = new RegExp(pattern, 'gi');
    } catch {
        regex = new RegExp(escapeRegex(pattern), 'gi');
    }

    const skip = new Set(['node_modules', '.git', 'out', 'dist', '.next', '__pycache__', '.venv']);

    function search(dir: string): void {
        if (results.length >= maxResults) { return; }
        let items: fs.Dirent[];
        try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

        for (const item of items) {
            if (results.length >= maxResults) { return; }
            if (skip.has(item.name)) { continue; }
            const fullPath = path.join(dir, item.name);
            if (item.isDirectory()) {
                search(fullPath);
            } else {
                if (filePattern && !matchGlob(item.name, filePattern)) { continue; }
                const ext = path.extname(item.name).toLowerCase();
                const binaryExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.zip', '.gz', '.tar', '.exe', '.dll', '.so', '.dylib', '.pdf']);
                if (binaryExts.has(ext)) { continue; }

                try {
                    const stat = fs.statSync(fullPath);
                    if (stat.size > 512 * 1024) { continue; }
                    const cached = fileCache.get(fullPath, stat.mtimeMs);
                    const content = cached || fs.readFileSync(fullPath, 'utf-8');
                    if (!cached) { fileCache.set(fullPath, content, stat.mtimeMs); }
                    const lines = content.split('\n');
                    for (let i = 0; i < lines.length && results.length < maxResults; i++) {
                        if (regex.test(lines[i])) {
                            const relPath = path.relative(root, fullPath).replace(/\\/g, '/');
                            results.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
                        }
                        regex.lastIndex = 0;
                    }
                } catch { /* skip unreadable files */ }
            }
        }
    }

    search(searchPath);

    if (results.length === 0) {
        return { content: `No matches found for "${pattern}"`, isError: false };
    }

    return {
        content: `Search results for "${pattern}" (${results.length}${results.length >= maxResults ? '+' : ''} matches):\n${results.join('\n')}`,
        isError: false,
    };
}

/** find_symbols — find function/class/interface definitions */
export async function toolFindSymbols(
    root: string,
    args: Record<string, unknown>
): Promise<{ content: string; isError: boolean }> {
    const pattern = args.pattern as string;
    const searchPath = args.path ? resolvePath(root, args.path as string) : root;

    const declPatterns = [
        `(?:export\\s+)?(?:async\\s+)?function\\s+\\w*${escapeRegex(pattern)}\\w*`,
        `(?:export\\s+)?(?:default\\s+)?class\\s+\\w*${escapeRegex(pattern)}\\w*`,
        `(?:export\\s+)?(?:interface|type)\\s+\\w*${escapeRegex(pattern)}\\w*`,
        `(?:export\\s+)?(?:const|let|var)\\s+\\w*${escapeRegex(pattern)}\\w*`,
        `def\\s+\\w*${escapeRegex(pattern)}\\w*`,
    ];
    const combinedRegex = new RegExp(`(${declPatterns.join('|')})`, 'gi');

    const results: string[] = [];
    const maxResults = 30;
    const skip = new Set(['node_modules', '.git', 'out', 'dist', '.next', '__pycache__', '.venv']);
    const binaryExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.zip', '.gz', '.tar', '.exe', '.dll', '.so', '.dylib', '.pdf']);

    function search(dir: string): void {
        if (results.length >= maxResults) { return; }
        let items: fs.Dirent[];
        try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

        for (const item of items) {
            if (results.length >= maxResults) { return; }
            if (skip.has(item.name)) { continue; }
            const fullPath = path.join(dir, item.name);
            if (item.isDirectory()) {
                search(fullPath);
            } else {
                const ext = path.extname(item.name).toLowerCase();
                if (binaryExts.has(ext)) { continue; }
                try {
                    const stat = fs.statSync(fullPath);
                    if (stat.size > 512 * 1024) { continue; }
                    const cached = fileCache.get(fullPath, stat.mtimeMs);
                    const content = cached || fs.readFileSync(fullPath, 'utf-8');
                    if (!cached) { fileCache.set(fullPath, content, stat.mtimeMs); }
                    const lines = content.split('\n');
                    for (let i = 0; i < lines.length && results.length < maxResults; i++) {
                        combinedRegex.lastIndex = 0;
                        if (combinedRegex.test(lines[i])) {
                            const relPath = path.relative(root, fullPath).replace(/\\/g, '/');
                            results.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
                        }
                    }
                } catch { /* skip */ }
            }
        }
    }

    search(searchPath);

    if (results.length === 0) {
        return { content: `No symbol definitions found matching "${pattern}"`, isError: false };
    }
    return {
        content: `Symbol definitions matching "${pattern}" (${results.length} found):\n${results.join('\n')}`,
        isError: false,
    };
}
