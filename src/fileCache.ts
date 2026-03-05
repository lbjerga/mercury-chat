/**
 * fileCache.ts — LRU file read cache (#11)
 * 
 * Caches file reads in memory to avoid redundant disk I/O during
 * tool execution, especially in rapid code agent loops where the
 * same file may be read multiple times.
 */

interface CacheEntry {
    content: string;
    mtime: number;
    accessedAt: number;
    size: number;
}

const MAX_ENTRIES = 50;
const DEFAULT_TTL_MS = 5000; // 5 second TTL

class FileCache {
    private cache = new Map<string, CacheEntry>();
    private _ttlMs = DEFAULT_TTL_MS;

    /** Temporarily extend TTL (e.g. during Rapid Code runs) */
    setTtl(ms: number): void { this._ttlMs = ms; }

    /** Reset TTL back to default */
    resetTtl(): void { this._ttlMs = DEFAULT_TTL_MS; }

    /** Get cached file content, or undefined if not cached / stale */
    get(filePath: string, currentMtime: number): string | undefined {
        const entry = this.cache.get(filePath);
        if (!entry) { return undefined; }

        // Check TTL
        if (Date.now() - entry.accessedAt > this._ttlMs) {
            this.cache.delete(filePath);
            return undefined;
        }

        // Check if file was modified
        if (entry.mtime !== currentMtime) {
            this.cache.delete(filePath);
            return undefined;
        }

        entry.accessedAt = Date.now();
        return entry.content;
    }

    /** Store file content in cache */
    set(filePath: string, content: string, mtime: number): void {
        // Evict oldest entries if at capacity
        if (this.cache.size >= MAX_ENTRIES) {
            let oldest: string | undefined;
            let oldestTime = Infinity;
            for (const [key, entry] of this.cache) {
                if (entry.accessedAt < oldestTime) {
                    oldestTime = entry.accessedAt;
                    oldest = key;
                }
            }
            if (oldest) { this.cache.delete(oldest); }
        }

        this.cache.set(filePath, {
            content,
            mtime,
            accessedAt: Date.now(),
            size: content.length,
        });
    }

    /** Invalidate a specific file (after write/edit) */
    invalidate(filePath: string): void {
        this.cache.delete(filePath);
    }

    /** Invalidate all entries */
    clear(): void {
        this.cache.clear();
    }

    /** Get cache stats */
    stats(): { entries: number; totalSize: number; hitRate: string } {
        let totalSize = 0;
        for (const entry of this.cache.values()) {
            totalSize += entry.size;
        }
        return {
            entries: this.cache.size,
            totalSize,
            hitRate: `${this.cache.size}/${MAX_ENTRIES} slots used`,
        };
    }
}

/** Singleton file cache */
export const fileCache = new FileCache();
