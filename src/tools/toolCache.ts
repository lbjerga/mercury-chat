/**
 * tools/toolCache.ts — Read-only tool result cache
 *
 * Caches results from read-only tools (read_file, list_files, etc.) to
 * avoid redundant disk I/O in agentic tool loops. Cache entries are
 * invalidated when a write tool modifies a matching file path, or when
 * the FileSystemWatcher fires.
 */

export interface CacheEntry {
    result: string;
    isError: boolean;
    timestamp: number;
}

const MAX_ENTRIES = 128;

class ToolResultCache {
    private _cache = new Map<string, CacheEntry>();

    /** Build a deterministic cache key from tool name + args */
    key(toolName: string, args: string): string {
        return `${toolName}::${args}`;
    }

    /** Get a cached result (returns undefined on cache miss) */
    get(toolName: string, args: string): CacheEntry | undefined {
        return this._cache.get(this.key(toolName, args));
    }

    /** Store a tool result */
    set(toolName: string, args: string, result: string, isError: boolean): void {
        // LRU eviction — drop oldest if at capacity
        if (this._cache.size >= MAX_ENTRIES) {
            const firstKey = this._cache.keys().next().value;
            if (firstKey !== undefined) { this._cache.delete(firstKey); }
        }
        this._cache.set(this.key(toolName, args), {
            result,
            isError,
            timestamp: Date.now(),
        });
    }

    /**
     * Invalidate all cache entries that reference the given file path.
     * Called after write_file / edit_file or on FileSystemWatcher events.
     */
    invalidatePath(filePath: string): void {
        // Normalize path separators for matching
        const normalized = filePath.replace(/\\/g, '/');
        for (const [key] of this._cache) {
            if (key.includes(normalized) || key.includes(filePath)) {
                this._cache.delete(key);
            }
        }
    }

    /** Invalidate all entries (e.g., on bulk file operations) */
    clear(): void {
        this._cache.clear();
    }

    /** Number of cached entries */
    get size(): number {
        return this._cache.size;
    }
}

/** Singleton tool result cache */
export const toolResultCache = new ToolResultCache();
