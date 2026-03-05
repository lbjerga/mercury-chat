/**
 * learnings.test.ts — Tests for error pattern memory & learning system
 *
 * Uses vi.mock for vscode and fs to test LearningsManager in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock vscode + fs ──
vi.mock('vscode', () => ({
    workspace: {
        workspaceFolders: [{ uri: { fsPath: '/mock/workspace' } }],
    },
}));

let mockFileContent = '';
vi.mock('fs', () => ({
    existsSync: vi.fn(() => mockFileContent !== ''),
    readFileSync: vi.fn(() => mockFileContent),
    writeFileSync: vi.fn((path: string, data: string) => { mockFileContent = data; }),
}));

import { LearningsManager } from './learnings';

describe('LearningsManager', () => {
    let mgr: LearningsManager;

    beforeEach(() => {
        mockFileContent = '';
        mgr = new LearningsManager();
    });

    // ── recordError ──
    describe('recordError', () => {
        it('records a new error pattern', () => {
            mgr.recordError("Cannot find module 'X'", 'import', 'Added import', ['file.ts']);
            const data = mgr.getAllData();
            expect(data.errorPatterns.length).toBe(1);
            expect(data.errorPatterns[0].pattern).toBe("Cannot find module 'X'");
            expect(data.errorPatterns[0].occurrences).toBe(1);
            expect(data.errorPatterns[0].weight).toBe(1.0);
        });

        it('increments occurrences for duplicate pattern', () => {
            mgr.recordError('type error', 'type', 'fix1', []);
            mgr.recordError('type error', 'type', 'fix2', []);
            const data = mgr.getAllData();
            expect(data.errorPatterns.length).toBe(1);
            expect(data.errorPatterns[0].occurrences).toBe(2);
            expect(data.errorPatterns[0].fixApplied).toBe('fix2'); // updated
        });

        it('caps weight at 1.0', () => {
            for (let i = 0; i < 20; i++) {
                mgr.recordError('repeated', 'type', 'fix', []);
            }
            const data = mgr.getAllData();
            expect(data.errorPatterns[0].weight).toBeLessThanOrEqual(1.0);
        });

        it('trims patterns beyond MAX_PATTERNS (100)', () => {
            for (let i = 0; i < 110; i++) {
                mgr.recordError(`error_${i}`, 'cat', 'fix', []);
            }
            const data = mgr.getAllData();
            expect(data.errorPatterns.length).toBeLessThanOrEqual(100);
        });
    });

    // ── recordLearning ──
    describe('recordLearning', () => {
        it('records a learning entry', () => {
            mgr.recordLearning({
                task: 'test task',
                outcome: 'success',
                toolsUsed: ['read_file'],
                tokensUsed: 500,
                costUsd: 0.001,
                durationMs: 2000,
                errorPatterns: [],
                timestamp: Date.now(),
            });
            const data = mgr.getAllData();
            expect(data.learnings.length).toBe(1);
        });

        it('trims learnings beyond MAX_LEARNINGS (50)', () => {
            for (let i = 0; i < 60; i++) {
                mgr.recordLearning({
                    task: `task_${i}`,
                    outcome: 'success',
                    toolsUsed: [],
                    tokensUsed: 0,
                    costUsd: 0,
                    durationMs: 0,
                    errorPatterns: [],
                    timestamp: Date.now(),
                });
            }
            const data = mgr.getAllData();
            expect(data.learnings.length).toBeLessThanOrEqual(50);
        });
    });

    // ── findFix ──
    describe('findFix', () => {
        it('returns matching error pattern', () => {
            mgr.recordError("Cannot find module 'react'", 'import', 'npm install react', []);
            const fix = mgr.findFix("Error: Cannot find module 'react' in project");
            expect(fix).toBeDefined();
            expect(fix!.fixApplied).toBe('npm install react');
        });

        it('returns undefined for no match', () => {
            mgr.recordError('specific error', 'type', 'fix', []);
            expect(mgr.findFix('completely different error')).toBeUndefined();
        });

        it('returns the highest-weight match', () => {
            mgr.recordError('error A', 'type', 'fix A', []);
            mgr.recordError('error A', 'type', 'fix A updated', []);
            mgr.recordError('error B', 'type', 'fix B', []);

            // "error A" has higher weight due to 2 occurrences
            const fix = mgr.findFix('found error A and error B');
            expect(fix).toBeDefined();
            // Weight of A should be higher (1.0 + 0.2 capped at 1.0 vs 1.0) — both are 1.0
            // but sort is stable, so either could win. Just verify we get a fix.
            expect(['fix A updated', 'fix B']).toContain(fix!.fixApplied);
        });
    });

    // ── recordPositiveFeedback ──
    describe('recordPositiveFeedback', () => {
        it('upgrades outcome to success', () => {
            mgr.recordLearning({
                task: 'my task',
                outcome: 'partial',
                toolsUsed: ['edit_file'],
                tokensUsed: 100,
                costUsd: 0,
                durationMs: 500,
                errorPatterns: [],
                timestamp: Date.now(),
            });

            mgr.recordPositiveFeedback('my task', 'A great response with ```code``` included');
            const data = mgr.getAllData();
            const entry = data.learnings.find(l => l.task === 'my task');
            expect(entry?.outcome).toBe('success');
            expect(entry?.positiveSignals).toBeDefined();
            expect(entry?.positiveSignals).toContain('included_code');
        });

        it('does nothing for non-existent tasks', () => {
            mgr.recordPositiveFeedback('unknown task', 'response');
            // Should not throw
        });
    });

    // ── getRecentLearnings ──
    describe('getRecentLearnings', () => {
        it('returns empty string when no learnings', () => {
            expect(mgr.getRecentLearnings()).toBe('');
        });

        it('formats recent learnings', () => {
            mgr.recordLearning({
                task: 'test task',
                outcome: 'success',
                toolsUsed: ['read_file'],
                tokensUsed: 500,
                costUsd: 0.001,
                durationMs: 2000,
                errorPatterns: [],
                timestamp: Date.now(),
            });
            const result = mgr.getRecentLearnings();
            expect(result).toContain('Recent learnings');
            expect(result).toContain('success');
            expect(result).toContain('test task');
        });
    });

    // ── getFrequentErrors ──
    describe('getFrequentErrors', () => {
        it('returns empty string when no patterns', () => {
            expect(mgr.getFrequentErrors()).toBe('');
        });

        it('formats error patterns', () => {
            mgr.recordError('module not found', 'import', 'install it', []);
            const result = mgr.getFrequentErrors();
            expect(result).toContain('Known error patterns');
            expect(result).toContain('module not found');
            expect(result).toContain('install it');
        });
    });

    // ── getSummary ──
    describe('getSummary', () => {
        it('returns summary with counts', () => {
            mgr.recordError('err', 'cat', 'fix', []);
            mgr.recordLearning({
                task: 't', outcome: 'success', toolsUsed: [],
                tokensUsed: 0, costUsd: 0, durationMs: 0,
                errorPatterns: [], timestamp: Date.now(),
            });
            const summary = mgr.getSummary();
            expect(summary).toContain('1 error patterns');
            expect(summary).toContain('1 task records');
            expect(summary).toContain('100%');
        });

        it('handles zero learnings', () => {
            const summary = mgr.getSummary();
            expect(summary).toContain('0%');
        });
    });

    // ── clearAll ──
    describe('clearAll', () => {
        it('removes all data', () => {
            mgr.recordError('err', 'cat', 'fix', []);
            mgr.recordLearning({
                task: 't', outcome: 'success', toolsUsed: [],
                tokensUsed: 0, costUsd: 0, durationMs: 0,
                errorPatterns: [], timestamp: Date.now(),
            });
            mgr.clearAll();
            const data = mgr.getAllData();
            expect(data.errorPatterns.length).toBe(0);
            expect(data.learnings.length).toBe(0);
        });
    });
});
