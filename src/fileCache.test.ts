/**
 * fileCache.test.ts — Tests for the LRU file read cache
 */
import { describe, it, expect, beforeEach } from 'vitest';

// The fileCache module exports a singleton; we test it via the public API
// We need to import the module to test it
const { fileCache } = await import('./fileCache');

describe('fileCache', () => {
    beforeEach(() => {
        fileCache.clear();
        fileCache.resetTtl();
    });

    it('returns undefined for uncached paths', () => {
        expect(fileCache.get('/foo.ts', 1000)).toBeUndefined();
    });

    it('caches and retrieves file content', () => {
        fileCache.set('/foo.ts', 'const x = 1;', 1000);
        expect(fileCache.get('/foo.ts', 1000)).toBe('const x = 1;');
    });

    it('invalidates on mtime change', () => {
        fileCache.set('/foo.ts', 'original', 1000);
        expect(fileCache.get('/foo.ts', 2000)).toBeUndefined();
    });

    it('invalidates specific files', () => {
        fileCache.set('/a.ts', 'a', 1);
        fileCache.set('/b.ts', 'b', 2);
        fileCache.invalidate('/a.ts');
        expect(fileCache.get('/a.ts', 1)).toBeUndefined();
        expect(fileCache.get('/b.ts', 2)).toBe('b');
    });

    it('clears all entries', () => {
        fileCache.set('/a.ts', 'a', 1);
        fileCache.set('/b.ts', 'b', 2);
        fileCache.clear();
        expect(fileCache.get('/a.ts', 1)).toBeUndefined();
        expect(fileCache.get('/b.ts', 2)).toBeUndefined();
    });

    it('reports correct stats', () => {
        fileCache.set('/a.ts', 'hello', 1);
        fileCache.set('/b.ts', 'world!', 2);
        const stats = fileCache.stats();
        expect(stats.entries).toBe(2);
        expect(stats.totalSize).toBe(11);
    });

    it('respects TTL', async () => {
        fileCache.setTtl(10); // 10ms TTL
        fileCache.set('/fast.ts', 'data', 1);
        expect(fileCache.get('/fast.ts', 1)).toBe('data');
        await new Promise(r => setTimeout(r, 20));
        expect(fileCache.get('/fast.ts', 1)).toBeUndefined();
    });

    it('evicts oldest entries when capacity exceeded', () => {
        // Cache capacity is 50 entries
        for (let i = 0; i < 55; i++) {
            fileCache.set(`/file-${i}.ts`, `content-${i}`, i);
        }
        const stats = fileCache.stats();
        expect(stats.entries).toBeLessThanOrEqual(50);
    });
});
