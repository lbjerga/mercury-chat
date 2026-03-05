/**
 * Smart Model Selector
 *
 * Analyzes message complexity / intent and returns a recommended model
 * override for the provider router.  The heuristics are intentionally
 * lightweight — they run synchronously on every request and simply
 * classify the task into one of three tiers:
 *
 *   • light   – quick Q&A, simple edits, short prompts
 *   • medium  – moderate coding, explanations, summarisation
 *   • heavy   – multi-file refactors, long prompts, reasoning-heavy
 *
 * Each provider has a mapping from tier → model so the router can
 * pick the best model for the job while keeping costs down.
 */

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type TaskTier = 'light' | 'medium' | 'heavy';

export interface ModelRecommendation {
    tier: TaskTier;
    /** Suggested model override for OpenRouter (undefined = keep default) */
    openRouterModel?: string;
    /** Suggested reasoning_effort for Mercury */
    mercuryEffort: 'low' | 'medium' | 'high';
}

// ──────────────────────────────────────────────
// Tier → model mapping (easily configurable)
// ──────────────────────────────────────────────

const OPENROUTER_TIER_MODELS: Record<TaskTier, string | undefined> = {
    light:  'google/gemini-2.0-flash-001',
    medium: undefined,                        // use user's default
    heavy:  'anthropic/claude-sonnet-4',
};

const MERCURY_EFFORT: Record<TaskTier, 'low' | 'medium' | 'high'> = {
    light:  'low',
    medium: 'medium',
    heavy:  'high',
};

// ──────────────────────────────────────────────
// Complexity heuristics
// ──────────────────────────────────────────────

/** Keywords / patterns that suggest a heavy task */
const HEAVY_PATTERNS = [
    /refactor/i,
    /redesign/i,
    /architect/i,
    /migration/i,
    /implement .*feature/i,
    /multi.?file/i,
    /rewrite/i,
    /optimize/i,
    /security.?audit/i,
    /unit.?test.*(entire|all|full)/i,
    /explain.*(codebase|architecture|system)/i,
];

/** Keywords that suggest a light task */
const LIGHT_PATTERNS = [
    /^(hi|hello|hey|thanks|thank you)/i,
    /what is/i,
    /how (do|to) (I |you )?/i,
    /quick question/i,
    /one.?liner/i,
    /fix (this|the) (typo|bug|error)/i,
    /rename/i,
    /format/i,
];

/**
 * Classify the complexity tier of a user message.
 */
export function classifyTier(userMessage: string, contextTokenEstimate: number): TaskTier {
    // Very long context → heavy regardless of keywords
    if (contextTokenEstimate > 12_000) return 'heavy';

    // Check heavy patterns first (they win on tie)
    for (const re of HEAVY_PATTERNS) {
        if (re.test(userMessage)) return 'heavy';
    }

    // Short messages with light keywords → light
    if (contextTokenEstimate < 2_000) {
        for (const re of LIGHT_PATTERNS) {
            if (re.test(userMessage)) return 'light';
        }
    }

    // Short prompt with no special keywords → light
    if (userMessage.length < 80 && contextTokenEstimate < 1_000) return 'light';

    return 'medium';
}

/**
 * Given a user message and approximate context size, return a model
 * recommendation the router can optionally use.
 */
export function selectModel(userMessage: string, contextTokenEstimate: number): ModelRecommendation {
    const tier = classifyTier(userMessage, contextTokenEstimate);
    return {
        tier,
        openRouterModel: OPENROUTER_TIER_MODELS[tier],
        mercuryEffort:   MERCURY_EFFORT[tier],
    };
}
