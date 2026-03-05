/**
 * gitContext.ts — Git-aware context for Mercury Chat
 *
 * Improvement #5: Include git diff (uncommitted changes) as context.
 * Improvement #17: Git stash checkpoint before Rapid Code runs.
 * Caching: git status, diff, branch cached with short TTL to avoid child process spawns.
 */

import * as cp from 'child_process';
import { getWorkspaceRoot } from './utils';

// ──────────────────────────────────────────────
// Git result cache (short TTL to avoid repeated child process spawns)
// ──────────────────────────────────────────────

interface GitCacheEntry {
    value: string;
    timestamp: number;
}

const GIT_CACHE_TTL_MS = 8_000; // 8 seconds
const _gitCache: Map<string, GitCacheEntry> = new Map();

function _getCached(key: string): string | undefined {
    const entry = _gitCache.get(key);
    if (!entry) { return undefined; }
    if (Date.now() - entry.timestamp > GIT_CACHE_TTL_MS) {
        _gitCache.delete(key);
        return undefined;
    }
    return entry.value;
}

function _setCache(key: string, value: string): void {
    _gitCache.set(key, { value, timestamp: Date.now() });
}

/** Invalidate all git caches (call after git-mutating operations) */
export function invalidateGitCache(): void {
    _gitCache.clear();
}

/**
 * Get git diff of uncommitted changes (staged + unstaged).
 * Returns empty string if not a git repo or no changes.
 */
export function getGitDiff(maxLength = 6000): Promise<string> {
    const cached = _getCached('diff');
    if (cached !== undefined) { return Promise.resolve(cached); }

    return new Promise((resolve) => {
        const root = getWorkspaceRoot();
        if (!root) { resolve(''); return; }

        // Try staged first, then unstaged
        cp.exec('git diff --staged', { cwd: root, maxBuffer: 1024 * 500 }, (err, staged) => {
            cp.exec('git diff', { cwd: root, maxBuffer: 1024 * 500 }, (err2, unstaged) => {
                const parts: string[] = [];

                if (staged?.trim()) {
                    parts.push(`**Staged changes:**\n\`\`\`diff\n${staged.trim()}\n\`\`\``);
                }
                if (unstaged?.trim()) {
                    parts.push(`**Unstaged changes:**\n\`\`\`diff\n${unstaged.trim()}\n\`\`\``);
                }

                if (parts.length === 0) { _setCache('diff', ''); resolve(''); return; }

                let result = '\n\n**Git uncommitted changes:**\n' + parts.join('\n\n');
                if (result.length > maxLength) {
                    result = result.slice(0, maxLength) + '\n...(truncated)';
                }
                _setCache('diff', result);
                resolve(result);
            });
        });
    });
}

/**
 * Get a short git status summary (files changed, insertions, deletions).
 */
export function getGitStatus(): Promise<string> {
    const cached = _getCached('status');
    if (cached !== undefined) { return Promise.resolve(cached); }

    return new Promise((resolve) => {
        const root = getWorkspaceRoot();
        if (!root) { resolve(''); return; }

        cp.exec('git status --short', { cwd: root, maxBuffer: 1024 * 100 }, (err, stdout) => {
            if (err || !stdout?.trim()) { _setCache('status', ''); resolve(''); return; }
            const lines = stdout.trim().split('\n');
            const result = `\n\n**Git status:** ${lines.length} changed file(s)\n\`\`\`\n${lines.slice(0, 20).join('\n')}${lines.length > 20 ? '\n...' : ''}\n\`\`\``;
            _setCache('status', result);
            resolve(result);
        });
    });
}

/**
 * Get current branch name.
 */
export function getGitBranch(): Promise<string> {
    const cached = _getCached('branch');
    if (cached !== undefined) { return Promise.resolve(cached); }

    return new Promise((resolve) => {
        const root = getWorkspaceRoot();
        if (!root) { resolve(''); return; }

        cp.exec('git branch --show-current', { cwd: root }, (err, stdout) => {
            const result = stdout?.trim() || '';
            _setCache('branch', result);
            resolve(result);
        });
    });
}

/**
 * Create a git stash as a checkpoint before Rapid Code runs.
 * Returns true if a stash was created.
 * Invalidates the git cache since stash changes the working tree state.
 */
export function gitStashCheckpoint(): Promise<boolean> {
    return new Promise((resolve) => {
        const root = getWorkspaceRoot();
        if (!root) { resolve(false); return; }

        const message = `mercury-rapid-code-checkpoint-${Date.now()}`;
        cp.exec(`git stash push -m "${message}" --include-untracked`, { cwd: root }, (err) => {
            invalidateGitCache();
            resolve(!err);
        });
    });
}

/**
 * Pop the latest git stash (rollback).
 */
export function gitStashPop(): Promise<boolean> {
    return new Promise((resolve) => {
        const root = getWorkspaceRoot();
        if (!root) { resolve(false); return; }

        cp.exec('git stash pop', { cwd: root }, (err) => {
            invalidateGitCache();
            resolve(!err);
        });
    });
}

/**
 * Get the full git diff for staged changes only (for PR/commit descriptions).
 */
export function getGitStagedDiff(): Promise<string> {
    return new Promise((resolve) => {
        const root = getWorkspaceRoot();
        if (!root) { resolve(''); return; }

        cp.exec('git diff --staged', { cwd: root, maxBuffer: 1024 * 500 }, (err, stdout) => {
            resolve(stdout?.trim() || '');
        });
    });
}

/**
 * Get the git log (last N commits).
 */
export function getGitLog(count = 10): Promise<string> {
    return new Promise((resolve) => {
        const root = getWorkspaceRoot();
        if (!root) { resolve(''); return; }

        cp.exec(`git log --oneline -${count}`, { cwd: root }, (err, stdout) => {
            resolve(stdout?.trim() || '');
        });
    });
}
