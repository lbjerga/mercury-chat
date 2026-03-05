/**
 * types/public.ts — Explicit public API type exports
 *
 * Improvement #3: Centralises every type that external consumers (or
 * other modules within the extension) may need, providing a single
 * stable contract surface.  Re-exported from `src/types.ts` for
 * backwards compatibility.
 */

// ── Chat & session types ──
export type {
    ChatSession,
    SessionIndex,
    ActiveFileContext,
} from '../types';

// ── Tool types ──
export type {
    ToolDefinition,
    ToolCall,
    ToolResult,
} from '../types';

// ── Rapid Code types ──
export type {
    RapidCodeInput,
    RapidCodePhase,
    RapidCodeGap,
    RapidCodeResult,
    RapidCodeProgress,
} from '../types';

// ── Session tool approval ──
export type {
    SessionToolApproval,
    ToolCallSummaryEntry,
} from '../types';

// ── Provider types ──
export type {
    ProviderId,
    ProviderCapabilities,
    ProviderPricing,
    ChatProvider,
    ChatRequestOptions,
    CircuitBreakerState,
    RouterConfig,
    ErrorKind,
} from '../providers/types';

export {
    PROVIDER_LABELS,
    PROVIDER_PRICING,
    DEFAULT_ROUTE_ORDER,
    DEFAULT_MAX_FAILURES,
    DEFAULT_COOLDOWN_MS,
    classifyError,
    isRetryableError,
} from '../providers/types';

// ── Mercury client types ──
export type {
    MercuryMessage,
    MercuryTextMessage,
    MercuryToolCallMessage,
    MercuryToolResultMessage,
    TokenUsage,
    StreamResult,
} from '../mercuryClient';

// ── Auto-reasoning ──
export type { ReasoningEffort } from '../autoReasoning';
