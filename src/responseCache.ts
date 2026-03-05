/**
 * responseCache.ts — Simple LRU cache for repeated identical prompts
 *
 * Avoids re-calling the LLM when the user resends the same message
 * within a short window (or on retry). Only caches NON-tool-call
 * responses (tool calls must always be executed fresh).
 *
 * Cache key = hash(messages JSON). Evicts least-recently-used when full.
 */

import * as crypto from 'crypto';
import { MercuryMessage, StreamResult, TokenUsage } from './mercuryClient';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface CacheEntry {
    result: CachedResult;
    timestamp: number;
    accessedAt: number;
}

export interface CachedResult {
    content: string;
    usage?: TokenUsage;
}

// ──────────────────────────────────────────────
// Cache
// ──────────────────────────────────────────────

const DEFAULT_MAX_ENTRIES = 32;
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class ResponseCache {
    private _cache: Map<string, CacheEntry> = new Map();
    private _maxEntries: number;
    private _ttlMs: number;

    constructor(maxEntries = DEFAULT_MAX_ENTRIES, ttlMs = DEFAULT_TTL_MS) {
        this._maxEntries = maxEntries;
        this._ttlMs = ttlMs;
    }

    /** Generate cache key from message array */
    private _key(messages: MercuryMessage[]): string {
        // Hash the last 3 messages (captures current exchange context)
        const tail = messages.slice(-3);
        const raw = JSON.stringify(tail.map(m => ({ role: m.role, content: m.content })));
        return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
    }

    /** Look up a cached response (returns undefined on miss) */
    get(messages: MercuryMessage[]): CachedResult | undefined {
        const key = this._key(messages);
        const entry = this._cache.get(key);
        if (!entry) { return undefined; }

        // Check TTL
        if (Date.now() - entry.timestamp > this._ttlMs) {
            this._cache.delete(key);
            return undefined;
        }

        entry.accessedAt = Date.now();
        return entry.result;
    }

    /** Store a response (only non-tool-call results) */
    set(messages: MercuryMessage[], result: CachedResult): void {
        const key = this._key(messages);

        // Evict LRU if at capacity
        if (this._cache.size >= this._maxEntries && !this._cache.has(key)) {
            let oldestKey: string | undefined;
            let oldestAccess = Infinity;
            for (const [k, v] of this._cache) {
                if (v.accessedAt < oldestAccess) {
                    oldestAccess = v.accessedAt;
                    oldestKey = k;
                }
            }
            if (oldestKey) { this._cache.delete(oldestKey); }
        }

        this._cache.set(key, {
            result,
            timestamp: Date.now(),
            accessedAt: Date.now(),
        });
    }

    /** Check if we have a valid cached entry */
    has(messages: MercuryMessage[]): boolean {
        return this.get(messages) !== undefined;
    }

    /** Clear the entire cache */
    clear(): void {
        this._cache.clear();
    }

    /** Number of entries */
    get size(): number {
        return this._cache.size;
    }
}

/** Singleton instance */
export const responseCache = new ResponseCache();
