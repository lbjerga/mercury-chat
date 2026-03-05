/**
 * learnings.ts — Error pattern memory & iteration learning (#26, #30)
 * 
 * Stores patterns of errors and successful fixes in workspace-level
 * .mercury-learnings.json so the agent can learn from past runs.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface ErrorPattern {
    pattern: string;         // e.g. "Cannot find module 'X'"
    category: string;        // e.g. "import", "type", "runtime"
    fixApplied: string;      // e.g. "Added missing import"
    filesInvolved: string[];
    occurrences: number;
    lastSeen: number;        // timestamp
    weight: number;          // relevance weight (decays over time)
}

export interface LearningEntry {
    task: string;
    outcome: 'success' | 'partial' | 'failure';
    toolsUsed: string[];
    tokensUsed: number;
    costUsd: number;
    durationMs: number;
    errorPatterns: string[];
    timestamp: number;
    positiveSignals?: string[];  // extracted from thumbs-up / successful completions
}

interface LearningsFile {
    version: 1;
    errorPatterns: ErrorPattern[];
    learnings: LearningEntry[];
}

const LEARNINGS_FILENAME = '.mercury-learnings.json';
const MAX_PATTERNS = 100;
const MAX_LEARNINGS = 50;

export class LearningsManager {
    private data: LearningsFile = { version: 1, errorPatterns: [], learnings: [] };
    private filePath: string | undefined;
    private _loaded = false;

    constructor() {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (root) {
            this.filePath = path.join(root, LEARNINGS_FILENAME);
            this._lazyLoad();
        }
    }

    /** Load from disk only once, then serve from memory */
    private _lazyLoad(): void {
        if (this._loaded) { return; }
        this._loaded = true;
        if (!this.filePath) { return; }
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, 'utf-8');
                this.data = JSON.parse(raw);
            }
        } catch {
            // Corrupt file, start fresh
            this.data = { version: 1, errorPatterns: [], learnings: [] };
        }
    }

    private save(): void {
        if (!this.filePath) { return; }
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
        } catch {
            // Ignore write errors
        }
    }

    /** Record an error pattern and its fix */
    recordError(pattern: string, category: string, fix: string, files: string[]): void {
        const existing = this.data.errorPatterns.find(p => p.pattern === pattern);
        if (existing) {
            existing.occurrences++;
            existing.lastSeen = Date.now();
            existing.fixApplied = fix;
            existing.weight = Math.min(existing.weight + 0.2, 1.0);
        } else {
            this.data.errorPatterns.push({
                pattern, category, fixApplied: fix, filesInvolved: files,
                occurrences: 1, lastSeen: Date.now(), weight: 1.0,
            });
        }
        // Trim old patterns
        if (this.data.errorPatterns.length > MAX_PATTERNS) {
            this.data.errorPatterns.sort((a, b) => b.lastSeen - a.lastSeen);
            this.data.errorPatterns = this.data.errorPatterns.slice(0, MAX_PATTERNS);
        }
        this.save();
    }

    /** Record a completed run's learning */
    recordLearning(entry: LearningEntry): void {
        this.data.learnings.push(entry);
        if (this.data.learnings.length > MAX_LEARNINGS) {
            this.data.learnings = this.data.learnings.slice(-MAX_LEARNINGS);
        }
        this.save();
    }

    /** Get known fixes for an error message (weighted by recency) */
    findFix(errorMessage: string): ErrorPattern | undefined {
        this._applyDecay();
        return this.data.errorPatterns
            .filter(p => errorMessage.includes(p.pattern) && p.weight > 0.1)
            .sort((a, b) => b.weight - a.weight)[0];
    }

    /** Apply time-based relevance decay to error patterns */
    private _applyDecay(): void {
        const now = Date.now();
        const ONE_DAY = 86400000;
        for (const p of this.data.errorPatterns) {
            const ageDays = (now - p.lastSeen) / ONE_DAY;
            if (ageDays > 7) {
                // Decay 5% per day after 7 days of inactivity
                p.weight = Math.max(0, (p.weight ?? 1.0) - (ageDays - 7) * 0.05);
            }
        }
        // Remove fully decayed patterns
        const before = this.data.errorPatterns.length;
        this.data.errorPatterns = this.data.errorPatterns.filter(p => (p.weight ?? 1.0) > 0);
        if (this.data.errorPatterns.length !== before) { this.save(); }
    }

    /** Record positive feedback (thumbs-up) — extracts useful signals */
    recordPositiveFeedback(task: string, response: string): void {
        // Find the most recent learning for this task and upgrade it
        const recent = this.data.learnings
            .filter(l => l.task === task)
            .sort((a, b) => b.timestamp - a.timestamp)[0];
        if (recent) {
            recent.outcome = 'success';
            // Extract positive signals: tools that worked, patterns that helped
            const signals: string[] = [];
            if (recent.toolsUsed.length > 0) {
                signals.push(`tools_effective: ${recent.toolsUsed.join(', ')}`);
            }
            if (response.length > 500) { signals.push('detailed_response'); }
            if (/```/.test(response)) { signals.push('included_code'); }
            recent.positiveSignals = signals;
            this.save();
        }
    }

    /** Get summary of recent learnings for prompt injection */
    getRecentLearnings(limit = 5): string {
        if (this.data.learnings.length === 0) { return ''; }
        const recent = this.data.learnings.slice(-limit);
        const lines = recent.map(l =>
            `- ${l.outcome}: "${l.task.slice(0, 80)}" (${l.tokensUsed} tokens, $${l.costUsd.toFixed(4)})${l.positiveSignals?.length ? ' [+' + l.positiveSignals.join(', ') + ']' : ''}`
        );
        return `Recent learnings:\n${lines.join('\n')}`;
    }

    /** Get frequent error patterns for prompt injection (weighted) */
    getFrequentErrors(limit = 5): string {
        if (this.data.errorPatterns.length === 0) { return ''; }
        this._applyDecay();
        const sorted = [...this.data.errorPatterns].sort((a, b) => (b.weight * b.occurrences) - (a.weight * a.occurrences));
        const top = sorted.slice(0, limit);
        const lines = top.map(e => `- "${e.pattern}" → fix: ${e.fixApplied} (${e.occurrences}x, w=${(e.weight ?? 1).toFixed(2)})`);
        return `Known error patterns:\n${lines.join('\n')}`;
    }

    /** Get all data for reporting */
    getAllData(): LearningsFile {
        return this.data;
    }

    /** Clear all learnings data */
    clearAll(): void {
        this.data = { version: 1, errorPatterns: [], learnings: [] };
        this.save();
    }

    /** Get a formatted summary for the user */
    getSummary(): string {
        const patterns = this.data.errorPatterns.length;
        const learnings = this.data.learnings.length;
        const successRate = learnings > 0
            ? ((this.data.learnings.filter(l => l.outcome === 'success').length / learnings) * 100).toFixed(0)
            : '0';
        return `Mercury Learnings: ${patterns} error patterns, ${learnings} task records (${successRate}% success rate)`;
    }
}

/** Singleton */
export const learningsManager = new LearningsManager();
