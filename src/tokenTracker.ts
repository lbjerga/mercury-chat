/**
 * tokenTracker.ts — Per-request and session-level token usage & cost tracking
 *
 * Tracks actual API-reported tokens (when available) and estimates
 * when the API doesn't return usage data (common with streaming).
 *
 * Multi-provider pricing (per 1M tokens):
 *   Copilot:      $0 (free with subscription)
 *   OpenRouter:   ~$0.15 input / $0.60 output (model-dependent)
 *   Ollama:       $0 (local)
 *   Mercury 2:    $0.25 input / $0.025 cached input / $0.75 output
 *
 * Rate limits (Mercury, per minute):
 *   API Requests:  1,000
 *   Input Tokens:  1,000,000
 *   Output Tokens:   100,000
 */

import { PROVIDER_PRICING, ProviderId } from './providers/types';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type TrackedProviderId = ProviderId;

export interface RequestRecord {
    timestamp: number;
    model: string;
    effort: string;
    command: string;
    /** Which provider handled this request */
    provider: TrackedProviderId;
    /** Actual input tokens from API (if reported) */
    apiInputTokens: number;
    /** Actual output tokens from API (if reported) */
    apiOutputTokens: number;
    /** Actual total tokens from API (if reported) */
    apiTotalTokens: number;
    /** Estimated input tokens (chars / 4) */
    estimatedInputTokens: number;
    /** Estimated output tokens (chars / 4) */
    estimatedOutputTokens: number;
    /** Number of tool calls in this request */
    toolCalls: number;
    /** Number of agentic rounds */
    rounds: number;
    /** Duration in ms */
    durationMs: number;
    /** Cost in USD for this request */
    costUsd: number;
    /** Money saved vs Mercury pricing for this request */
    savedUsd: number;
}

export interface SessionStats {
    /** Total requests this session */
    totalRequests: number;
    /** Sum of all API-reported input tokens */
    totalApiInputTokens: number;
    /** Sum of all API-reported output tokens */
    totalApiOutputTokens: number;
    /** Sum of all API-reported total tokens */
    totalApiTokens: number;
    /** Sum of estimated input tokens */
    totalEstimatedInputTokens: number;
    /** Sum of estimated output tokens */
    totalEstimatedOutputTokens: number;
    /** Best available total: API if reported, estimated otherwise */
    totalBestEstimate: number;
    /** Average tokens per request */
    avgTokensPerRequest: number;
    /** Total tool calls across session */
    totalToolCalls: number;
    /** Total session duration (sum of request durations) */
    totalDurationMs: number;
    /** Rate limit usage: % of input budget used per minute (approx) */
    inputBudgetPct: number;
    /** Rate limit usage: % of output budget used per minute (approx) */
    outputBudgetPct: number;
    /** Total estimated cost in USD */
    totalCostUsd: number;
    /** Total USD saved by using non-Mercury providers */
    totalSavedUsd: number;
    /** Per-request breakdown */
    requests: RequestRecord[];
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const CHARS_PER_TOKEN = 4;
const RATE_LIMIT_INPUT_PER_MIN = 1_000_000;
const RATE_LIMIT_OUTPUT_PER_MIN = 100_000;
const RATE_LIMIT_REQUESTS_PER_MIN = 1_000;

// Legacy constants (used as defaults when provider is not specified)
const INPUT_PRICE_PER_1M = 0.25;
const CACHED_INPUT_PRICE_PER_1M = 0.025;
const OUTPUT_PRICE_PER_1M = 0.75;

// ──────────────────────────────────────────────
// Token Tracker (singleton)
// ──────────────────────────────────────────────

class TokenTracker {
    private requests: RequestRecord[] = [];
    private sessionStart: number = Date.now();
    /** Cached session stats — invalidated when a new record is added */
    private _cachedStats: SessionStats | undefined;
    private _statsDirty = true;
    /** Calibration factor for token estimation (EMA, α=0.1) */
    private _calibrationFactor = 1.0;
    private _calibrationSamples = 0;

    // ── Estimation helpers ──

    /** Estimate tokens from character count, adjusted by calibration */
    estimateTokens(chars: number): number {
        return Math.ceil((chars / CHARS_PER_TOKEN) * this._calibrationFactor);
    }

    /** Get calibrated token estimate (for external callers like contextBudget) */
    getCalibratedEstimate(chars: number): number {
        return this.estimateTokens(chars);
    }

    /** Current calibration factor (1.0 = no adjustment) */
    get calibrationFactor(): number {
        return this._calibrationFactor;
    }

    /** Estimate input tokens from a messages array */
    estimateInputFromMessages(messages: Array<{ content?: string | null; role?: string }>): number {
        let totalChars = 0;
        for (const msg of messages) {
            if (msg.content) {
                totalChars += msg.content.length;
            }
            // Add overhead for role, formatting
            totalChars += 10;
        }
        return this.estimateTokens(totalChars);
    }

    /** Estimate output tokens from response text */
    estimateOutputFromResponse(responseText: string): number {
        return this.estimateTokens(responseText.length);
    }

    /**
     * Batch-estimate tokens for multiple text chunks in one call.
     * Improvement #14: Avoids sequential per-message overhead and
     * prepares for future async tokeniser integration.
     */
    batchEstimate(texts: string[]): number[] {
        return texts.map(t => this.estimateTokens(t.length));
    }

    /**
     * Sum token estimate for a list of text chunks.
     * Convenience shorthand for `batchEstimate().reduce()`.
     */
    batchEstimateTotal(texts: string[]): number {
        let total = 0;
        for (const t of texts) { total += this.estimateTokens(t.length); }
        return total;
    }

    // ── Recording ──

    /** Record a completed request with all available data */
    recordRequest(params: {
        model: string;
        effort: string;
        command: string;
        provider?: TrackedProviderId;
        apiInputTokens?: number;
        apiOutputTokens?: number;
        apiTotalTokens?: number;
        estimatedInputChars: number;
        estimatedOutputChars: number;
        toolCalls: number;
        rounds: number;
        durationMs: number;
    }): RequestRecord {
        const provider = params.provider ?? 'mercury';
        const inputTokens = params.apiInputTokens || this.estimateTokens(params.estimatedInputChars);
        const outputTokens = params.apiOutputTokens || this.estimateTokens(params.estimatedOutputChars);
        const costUsd = this.calculateCost(inputTokens, outputTokens, provider);
        const mercuryCost = this.calculateCost(inputTokens, outputTokens, 'mercury');
        const savedUsd = Math.max(0, mercuryCost - costUsd);

        const record: RequestRecord = {
            timestamp: Date.now(),
            model: params.model,
            effort: params.effort,
            command: params.command,
            provider,
            apiInputTokens: params.apiInputTokens || 0,
            apiOutputTokens: params.apiOutputTokens || 0,
            apiTotalTokens: params.apiTotalTokens || 0,
            estimatedInputTokens: this.estimateTokens(params.estimatedInputChars),
            estimatedOutputTokens: this.estimateTokens(params.estimatedOutputChars),
            toolCalls: params.toolCalls,
            rounds: params.rounds,
            durationMs: params.durationMs,
            costUsd,
            savedUsd,
        };
        this.requests.push(record);
        this._statsDirty = true;

        // ═══ Calibration: update EMA from API actuals vs estimates ═══
        if (params.apiInputTokens && params.apiInputTokens > 50) {
            const rawEstimate = Math.ceil(params.estimatedInputChars / CHARS_PER_TOKEN);
            if (rawEstimate > 0) {
                const ratio = params.apiInputTokens / rawEstimate;
                if (this._calibrationSamples === 0) {
                    this._calibrationFactor = ratio;
                } else {
                    // Exponential moving average (alpha = 0.1)
                    this._calibrationFactor = 0.9 * this._calibrationFactor + 0.1 * ratio;
                }
                // Clamp to reasonable range to prevent runaway values
                this._calibrationFactor = Math.max(0.5, Math.min(3.0, this._calibrationFactor));
                this._calibrationSamples++;
            }
        }

        // Memory pruning: keep only the last 200 request records
        if (this.requests.length > 200) {
            this.requests = this.requests.slice(-200);
        }
        return record;
    }

    /** Calculate cost in USD from token counts (provider-aware) */
    private calculateCost(inputTokens: number, outputTokens: number, provider: TrackedProviderId = 'mercury'): number {
        const pricing = PROVIDER_PRICING[provider] ?? PROVIDER_PRICING.mercury;
        const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
        const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
        return inputCost + outputCost;
    }

    /** Format USD cost with appropriate precision */
    private formatCost(usd: number): string {
        if (usd < 0.001) return '<$0.001';
        if (usd < 0.01) return `$${usd.toFixed(4)}`;
        if (usd < 1) return `$${usd.toFixed(3)}`;
        return `$${usd.toFixed(2)}`;
    }

    // ── Reporting ──

    /** Get comprehensive session statistics (cached until next recordRequest) */
    getSessionStats(): SessionStats {
        if (!this._statsDirty && this._cachedStats) {
            // Rate-limit fields (last 60s) may become stale; recompute them
            const now = Date.now();
            const recentRequests = this.requests.filter(r => now - r.timestamp < 60_000);
            let recentInput = 0;
            let recentOutput = 0;
            for (const r of recentRequests) {
                recentInput += r.apiInputTokens || r.estimatedInputTokens;
                recentOutput += r.apiOutputTokens || r.estimatedOutputTokens;
            }
            this._cachedStats.inputBudgetPct = Math.round((recentInput / RATE_LIMIT_INPUT_PER_MIN) * 100);
            this._cachedStats.outputBudgetPct = Math.round((recentOutput / RATE_LIMIT_OUTPUT_PER_MIN) * 100);
            return this._cachedStats;
        }

        const stats: SessionStats = {
            totalRequests: this.requests.length,
            totalApiInputTokens: 0,
            totalApiOutputTokens: 0,
            totalApiTokens: 0,
            totalEstimatedInputTokens: 0,
            totalEstimatedOutputTokens: 0,
            totalBestEstimate: 0,
            avgTokensPerRequest: 0,
            totalToolCalls: 0,
            totalDurationMs: 0,
            inputBudgetPct: 0,
            outputBudgetPct: 0,
            totalCostUsd: 0,
            totalSavedUsd: 0,
            requests: this.requests,
        };

        for (const r of this.requests) {
            stats.totalApiInputTokens += r.apiInputTokens;
            stats.totalApiOutputTokens += r.apiOutputTokens;
            stats.totalApiTokens += r.apiTotalTokens;
            stats.totalEstimatedInputTokens += r.estimatedInputTokens;
            stats.totalEstimatedOutputTokens += r.estimatedOutputTokens;
            stats.totalToolCalls += r.toolCalls;
            stats.totalDurationMs += r.durationMs;
            stats.totalCostUsd += r.costUsd;
            stats.totalSavedUsd += r.savedUsd;

            // Best estimate: use API value if available, otherwise estimated
            const bestInput = r.apiInputTokens || r.estimatedInputTokens;
            const bestOutput = r.apiOutputTokens || r.estimatedOutputTokens;
            stats.totalBestEstimate += bestInput + bestOutput;
        }

        if (this.requests.length > 0) {
            stats.avgTokensPerRequest = Math.round(stats.totalBestEstimate / this.requests.length);
        }

        // Rate limit budget estimation (over the last 60 seconds)
        const now = Date.now();
        const recentRequests = this.requests.filter(r => now - r.timestamp < 60_000);
        let recentInput = 0;
        let recentOutput = 0;
        for (const r of recentRequests) {
            recentInput += r.apiInputTokens || r.estimatedInputTokens;
            recentOutput += r.apiOutputTokens || r.estimatedOutputTokens;
        }
        stats.inputBudgetPct = Math.round((recentInput / RATE_LIMIT_INPUT_PER_MIN) * 100);
        stats.outputBudgetPct = Math.round((recentOutput / RATE_LIMIT_OUTPUT_PER_MIN) * 100);

        this._cachedStats = stats;
        this._statsDirty = false;
        return stats;
    }

    /** Get the last request record */
    getLastRequest(): RequestRecord | undefined {
        return this.requests.length > 0 ? this.requests[this.requests.length - 1] : undefined;
    }

    /** Format a compact stats line for the chat footer */
    formatFooterStats(lastRequest: RequestRecord): string {
        const stats = this.getSessionStats();
        const parts: string[] = [];

        // Per-request info
        const reqTokens = lastRequest.apiTotalTokens || (lastRequest.estimatedInputTokens + lastRequest.estimatedOutputTokens);
        parts.push(`${this.formatNumber(reqTokens)} tokens`);
        parts.push(this.formatCost(lastRequest.costUsd));

        if (lastRequest.toolCalls > 0) {
            parts.push(`${lastRequest.toolCalls} tool calls`);
        }

        parts.push(`${lastRequest.model}`);
        parts.push(`effort: ${lastRequest.effort}`);
        parts.push(`${(lastRequest.durationMs / 1000).toFixed(1)}s`);

        // Session cumulative
        const sessionLine = `Session: ${this.formatNumber(stats.totalBestEstimate)} tokens · ${this.formatCost(stats.totalCostUsd)} · ${stats.totalRequests} requests` + (stats.totalSavedUsd > 0.001 ? ` · saved ${this.formatCost(stats.totalSavedUsd)}` : '');

        // Rate limit indicator
        let rateIndicator = '';
        if (stats.outputBudgetPct > 70) {
            rateIndicator = ` · ⚠️ ${stats.outputBudgetPct}% output budget`;
        } else if (stats.inputBudgetPct > 70) {
            rateIndicator = ` · ⚠️ ${stats.inputBudgetPct}% input budget`;
        }

        return `${parts.join(' · ')}\n${sessionLine}${rateIndicator}`;
    }

    /** Format a detailed usage report (for output channel) */
    formatDetailedReport(): string {
        const stats = this.getSessionStats();
        const lines: string[] = [
            '═══ Mercury Token Usage & Cost Report ═══',
            '',
            `Session Duration: ${this.formatDuration(Date.now() - this.sessionStart)}`,
            `Total Requests:   ${stats.totalRequests}`,
            `Total Cost:       ${this.formatCost(stats.totalCostUsd)}`,
            `Saved (vs Mercury): ${this.formatCost(stats.totalSavedUsd)}`,
            '',
            '── Pricing ──',
            `  Input:  $0.25 / 1M tokens  (cached: $0.025 / 1M)`,
            `  Output: $0.75 / 1M tokens`,
            '',
            '── Token Totals ──',
            `  API Reported:     ${this.formatNumber(stats.totalApiTokens)} (input: ${this.formatNumber(stats.totalApiInputTokens)}, output: ${this.formatNumber(stats.totalApiOutputTokens)})`,
            `  Estimated:        ${this.formatNumber(stats.totalEstimatedInputTokens + stats.totalEstimatedOutputTokens)} (input: ${this.formatNumber(stats.totalEstimatedInputTokens)}, output: ${this.formatNumber(stats.totalEstimatedOutputTokens)})`,
            `  Best Estimate:    ${this.formatNumber(stats.totalBestEstimate)}`,
            `  Avg per Request:  ${this.formatNumber(stats.avgTokensPerRequest)}`,
            '',
            '── Cost Breakdown ──',
            `  Input Cost:   ${this.formatCost((stats.totalApiInputTokens || stats.totalEstimatedInputTokens) / 1_000_000 * INPUT_PRICE_PER_1M)}`,
            `  Output Cost:  ${this.formatCost((stats.totalApiOutputTokens || stats.totalEstimatedOutputTokens) / 1_000_000 * OUTPUT_PRICE_PER_1M)}`,
            `  Total Cost:   ${this.formatCost(stats.totalCostUsd)}`,
            '',
            '── Rate Limit Budget (last 60s) ──',
            `  Input:  ${stats.inputBudgetPct}% of ${this.formatNumber(RATE_LIMIT_INPUT_PER_MIN)}/min`,
            `  Output: ${stats.outputBudgetPct}% of ${this.formatNumber(RATE_LIMIT_OUTPUT_PER_MIN)}/min`,
            '',
            '── Tool Calls ──',
            `  Total: ${stats.totalToolCalls}`,
            '',
            '── Per-Request Breakdown ──',
        ];

        for (let i = 0; i < this.requests.length; i++) {
            const r = this.requests[i];
            const tokens = r.apiTotalTokens || (r.estimatedInputTokens + r.estimatedOutputTokens);
            const time = new Date(r.timestamp).toLocaleTimeString();
            lines.push(`  #${i + 1} [${time}] ${r.command || 'chat'} · ${this.formatNumber(tokens)} tokens · ${this.formatCost(r.costUsd)} · ${r.toolCalls} tools · ${r.effort} · ${(r.durationMs / 1000).toFixed(1)}s`);
        }

        lines.push('');
        lines.push('═════════════════════════════════════════');
        return lines.join('\n');
    }

    /** Reset all session data */
    resetSession(): void {
        this.requests = [];
        this.sessionStart = Date.now();
        this._cachedStats = undefined;
        this._statsDirty = true;
        this._calibrationFactor = 1.0;
        this._calibrationSamples = 0;
    }

    // ── Budget guardrail (#2) ──

    /** Get current session cost in USD */
    getSessionCost(): number {
        return this.requests.reduce((sum, r) => sum + r.costUsd, 0);
    }

    /** Cost of the most recent request (for learnings) */
    getLastRequestCost(): number {
        return this.requests.length > 0 ? this.requests[this.requests.length - 1].costUsd : 0;
    }

    /** Check if session cost exceeds the budget (0 = disabled) */
    isOverBudget(maxUsd: number): boolean {
        if (maxUsd <= 0) { return false; }
        return this.getSessionCost() >= maxUsd;
    }

    /** Format budget warning message */
    getBudgetWarning(maxUsd: number): string {
        const cost = this.getSessionCost();
        return `Session cost $${cost.toFixed(4)} has reached the budget limit of $${maxUsd.toFixed(2)}. Reset token stats or increase mercuryChat.maxSessionCostUsd to continue.`;
    }

    // ── Persistence (#8) ──

    /** Serialize session data for storage */
    toJSON(): { requests: RequestRecord[]; sessionStart: number } {
        return { requests: this.requests, sessionStart: this.sessionStart };
    }

    /** Restore session data from storage */
    fromJSON(data: { requests?: RequestRecord[]; sessionStart?: number }): void {
        if (data.requests && Array.isArray(data.requests)) {
            this.requests = data.requests;
        }
        if (data.sessionStart) {
            this.sessionStart = data.sessionStart;
        }
        this._statsDirty = true;
    }

    // ── Formatting helpers ──

    private formatNumber(n: number): string {
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
        if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
        return String(n);
    }

    private formatDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (minutes < 60) return `${minutes}m ${secs}s`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
    }
}

/** Singleton instance — tracks tokens across the entire extension session */
export const tokenTracker = new TokenTracker();
