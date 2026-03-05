/**
 * tools/helpers.ts — Shared helpers for tool implementations
 */

import * as path from 'path';

/** Resolve a relative path safely within the workspace root, preventing traversal */
export function resolvePath(workspaceRoot: string, relativePath: string): string {
    const resolved = path.resolve(workspaceRoot, relativePath);
    if (!resolved.startsWith(workspaceRoot)) {
        throw new Error(`Path "${relativePath}" is outside the workspace`);
    }
    return resolved;
}
