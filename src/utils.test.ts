/**
 * utils.test.ts — Unit tests for utility functions
 */
import { describe, it, expect, vi } from 'vitest';

// Mock vscode module since utils.ts imports it
vi.mock('vscode', () => ({
    workspace: { workspaceFolders: undefined },
}));

import { generateId, getNonce, escapeRegex, matchGlob, debounce } from './utils';

describe('generateId', () => {
    it('returns a non-empty string', () => {
        const id = generateId();
        expect(id).toBeTruthy();
        expect(typeof id).toBe('string');
    });

    it('returns unique IDs', () => {
        const ids = new Set(Array.from({ length: 100 }, () => generateId()));
        expect(ids.size).toBe(100);
    });

    it('contains a hyphen separator', () => {
        expect(generateId()).toMatch(/-/);
    });
});

describe('getNonce', () => {
    it('returns a 32-character string', () => {
        expect(getNonce()).toHaveLength(32);
    });

    it('contains only alphanumeric characters', () => {
        expect(getNonce()).toMatch(/^[A-Za-z0-9]{32}$/);
    });
});

describe('escapeRegex', () => {
    it('escapes special regex characters', () => {
        expect(escapeRegex('hello.world')).toBe('hello\\.world');
        expect(escapeRegex('a+b*c?')).toBe('a\\+b\\*c\\?');
        expect(escapeRegex('(test)[0]')).toBe('\\(test\\)\\[0\\]');
    });

    it('leaves plain strings unchanged', () => {
        expect(escapeRegex('hello')).toBe('hello');
    });
});

describe('matchGlob', () => {
    it('matches simple wildcards', () => {
        expect(matchGlob('hello.ts', '*.ts')).toBe(true);
        expect(matchGlob('hello.js', '*.ts')).toBe(false);
    });

    it('matches double-star glob (any depth)', () => {
        expect(matchGlob('src/foo/bar.ts', '**/*.ts')).toBe(true);
        // Note: **/* requires at least one directory separator
        expect(matchGlob('src/bar.ts', '**/*.ts')).toBe(true);
    });

    it('matches question mark (single char)', () => {
        expect(matchGlob('a.ts', '?.ts')).toBe(true);
        expect(matchGlob('ab.ts', '?.ts')).toBe(false);
    });

    it('is case-insensitive', () => {
        expect(matchGlob('Hello.TS', '*.ts')).toBe(true);
    });
});

describe('debounce', () => {
    it('delays execution', async () => {
        vi.useFakeTimers();
        const fn = vi.fn();
        const debounced = debounce(fn, 100);

        debounced();
        expect(fn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledOnce();

        vi.useRealTimers();
    });

    it('resets timer on subsequent calls', async () => {
        vi.useFakeTimers();
        const fn = vi.fn();
        const debounced = debounce(fn, 100);

        debounced();
        vi.advanceTimersByTime(50);
        debounced(); // Reset
        vi.advanceTimersByTime(50);
        expect(fn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(50);
        expect(fn).toHaveBeenCalledOnce();

        vi.useRealTimers();
    });
});
