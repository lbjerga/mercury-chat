/**
 * autoReasoning.ts — Auto-adjust reasoning effort based on request complexity
 *
 * Analyzes the user prompt, context size, and task type to pick
 * the optimal reasoning_effort level: instant | low | medium | high
 *
 * This saves output tokens on simple tasks and reserves deep thinking
 * for complex multi-step or architectural work.
 *
 * Rate limits reference (per minute):
 *   Input:  1,000,000 tokens
 *   Output:   100,000 tokens
 *   Requests:     1,000
 */

export type ReasoningEffort = 'instant' | 'low' | 'medium' | 'high';

interface ComplexitySignals {
    /** The raw user prompt */
    prompt: string;
    /** Slash command (if any) */
    command?: string;
    /** Number of referenced files attached */
    referenceCount: number;
    /** Total characters in all references */
    referenceSize: number;
    /** Number of chat history turns */
    historyTurns: number;
    /** Whether active editor has errors */
    hasErrors: boolean;
    /** Number of files in workspace tree */
    workspaceFileCount: number;
    /** Whether it's a follow-up in a multi-step conversation */
    isFollowUp: boolean;
}

/** Keywords that indicate simple, quick-answer queries */
const INSTANT_PATTERNS = [
    /^(hi|hello|hey|thanks|thank you|ok|yes|no|sure|got it)/i,
    /^what is (a |an |the )?[\w\s]{1,20}\??$/i,
    /^(how do i|how to) (import|install|run|start|open)/i,
    /^(show|list|what are) (the )?(commands|shortcuts|keybindings)/i,
];

/** Keywords that signal low-effort tasks */
const LOW_PATTERNS = [
    /\b(explain|what does|what is|describe|summarize|overview)\b/i,
    /\b(rename|format|indent|lint|typo|spelling)\b/i,
    /\b(add (a )?comment|add (a )?log|console\.log)\b/i,
    /\b(translate|convert) (to|into)\b/i,
];

/** Keywords that signal high-effort deep reasoning */
const HIGH_PATTERNS = [
    /\b(architect|design|system design|redesign)\b/i,
    /\b(refactor|restructure|rewrite|migrate|overhaul)\b/i,
    /\b(implement|build|create) (a |an )?(full|complete|entire|whole)\b/i,
    /\b(debug|investigate|figure out|root cause|why (is|does|doesn't|isn't))\b/i,
    /\b(review|audit|analyze|security|vulnerability|performance)\b/i,
    /\b(complex|complicated|tricky|challenging|edge case)\b/i,
    /\b(multi.?(file|step|part)|across (files|modules|components))\b/i,
    /\b(pull request|pr description|changelog)\b/i,
    /\b(test (suite|coverage|strategy)|integration test)\b/i,
    /\boptimize\b/i,
];

/** Command-to-baseline effort mapping */
const COMMAND_EFFORT: Record<string, ReasoningEffort> = {
    explain: 'low',
    fix: 'medium',
    test: 'high',
    review: 'high',
    doc: 'low',
    refactor: 'high',
    optimize: 'high',
    new: 'medium',
    rapid: 'high',      // Rapid Code always benefits from deep thought
    search: 'low',
    commit: 'low',
    terminal: 'low',
    outline: 'medium',
    pr: 'high',
};

/**
 * Determine the optimal reasoning effort for a given request.
 * Returns an effort level and short explanation for the output channel log.
 */
export function autoDetectEffort(signals: ComplexitySignals): { effort: ReasoningEffort; reason: string } {
    const { prompt, command, referenceCount, referenceSize, historyTurns, hasErrors, isFollowUp } = signals;

    // 1. Command-based baseline
    if (command && COMMAND_EFFORT[command]) {
        const baseline = COMMAND_EFFORT[command];
        // Short prompts with a specific command → use the command's baseline
        if (prompt.length < 50) {
            return { effort: baseline, reason: `/${command} baseline` };
        }
    }

    // 2. Instant patterns (greetings, trivial questions)
    for (const pat of INSTANT_PATTERNS) {
        if (pat.test(prompt)) {
            return { effort: 'instant', reason: 'trivial/greeting pattern' };
        }
    }

    // 3. Score-based complexity analysis
    let score = 0;
    let reasons: string[] = [];

    // Prompt length scoring
    if (prompt.length > 500) { score += 2; reasons.push('long prompt'); }
    else if (prompt.length > 200) { score += 1; reasons.push('medium prompt'); }
    else if (prompt.length < 30) { score -= 1; }

    // High-complexity keyword matches
    for (const pat of HIGH_PATTERNS) {
        if (pat.test(prompt)) { score += 2; reasons.push('complex keyword'); break; }
    }

    // Low-complexity keyword matches
    for (const pat of LOW_PATTERNS) {
        if (pat.test(prompt)) { score -= 1; reasons.push('simple keyword'); break; }
    }

    // Reference context scoring
    if (referenceCount >= 3) { score += 2; reasons.push(`${referenceCount} refs`); }
    else if (referenceCount >= 1) { score += 1; }

    if (referenceSize > 10000) { score += 1; reasons.push('large refs'); }

    // Conversation depth — longer conversations tend to have complex tasks
    if (historyTurns >= 6) { score += 2; reasons.push('deep conversation'); }
    else if (historyTurns >= 3) { score += 1; reasons.push('multi-turn'); }

    // Active errors suggest a fix task (medium)
    if (hasErrors) { score += 1; reasons.push('has errors'); }

    // Follow-up in conversation → slightly more context needed
    if (isFollowUp && prompt.length < 100) { score -= 1; reasons.push('short follow-up'); }

    // Question marks reduce effort (likely asking for explanation)
    if (prompt.includes('?') && prompt.length < 100) { score -= 1; }

    // Multiple questions/requests increase effort
    const questionCount = (prompt.match(/\?/g) || []).length;
    if (questionCount >= 3) { score += 1; reasons.push('multiple questions'); }

    // Numbered lists / bullet points suggest multi-step
    const listItems = (prompt.match(/^\s*[-*\d]+[\.\)]/gm) || []).length;
    if (listItems >= 3) { score += 2; reasons.push(`${listItems} list items`); }

    // Code blocks in prompt suggest complex context
    const codeBlocks = (prompt.match(/```/g) || []).length / 2;
    if (codeBlocks >= 1) { score += 1; reasons.push('contains code'); }

    // 4. Map score to effort
    let effort: ReasoningEffort;
    if (score <= -1) { effort = 'instant'; }
    else if (score <= 1) { effort = 'low'; }
    else if (score <= 3) { effort = 'medium'; }
    else { effort = 'high'; }

    // 5. Command override — never go below the command baseline
    if (command && COMMAND_EFFORT[command]) {
        const baseline = COMMAND_EFFORT[command];
        const levels: ReasoningEffort[] = ['instant', 'low', 'medium', 'high'];
        const effortIdx = levels.indexOf(effort);
        const baselineIdx = levels.indexOf(baseline);
        if (effortIdx < baselineIdx) {
            effort = baseline;
            reasons.push(`raised to /${command} baseline`);
        }
    }

    return { effort, reason: reasons.slice(0, 3).join(', ') || 'default scoring' };
}

/**
 * Estimate total tokens for the current request context.
 * Uses ~4 chars per token approximation.
 */
export function estimateTokens(messages: Array<{ content?: string | null }>): number {
    let totalChars = 0;
    for (const msg of messages) {
        if (msg.content) {
            totalChars += msg.content.length;
        }
    }
    return Math.ceil(totalChars / 4);
}

/**
 * Check if we should throttle to conserve rate limits.
 * With 100K output tokens/min, warn if recent usage is high.
 */
export function shouldThrottleEffort(
    recentOutputTokens: number,
    windowMs: number = 60000
): { throttle: boolean; suggestion?: ReasoningEffort } {
    // If we've used >70K of the 100K output budget in the last minute, throttle
    if (recentOutputTokens > 70000) {
        return { throttle: true, suggestion: 'low' };
    }
    if (recentOutputTokens > 50000) {
        return { throttle: true, suggestion: 'medium' };
    }
    return { throttle: false };
}
