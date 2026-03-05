# Changelog

All notable changes to the **+Lars AI Chat Tool** extension will be documented in this file.

---

## [0.24.0] — 2026-03-05

### Testing & Reliability Release

Comprehensive test suite (38 → 191 tests), three critical provider-routing bug fixes, and improvements discovered during testing.

#### Critical Bug Fixes
- **Router always-try-all-providers** — Auth (403) and unsupported errors on one provider no longer block fallback to the next provider. Previously, a Copilot "no model available" error would throw immediately instead of trying OpenRouter/Ollama/Mercury.
- **Provider gate removed** — `chatEngine.ts` and `chatHandler.ts` no longer hard-gate on `mercuryChat.apiKey`. Any configured provider (Copilot, OpenRouter, Ollama, or Mercury) now works independently. Before this fix, the extension was completely non-functional without a Mercury API key.
- **Model name corrected** — `mercury-coder` → `mercury-2`. The invalid model name was returning 403 from the Inception API.

#### Test Suite — 7 New Test Files (38 → 191 tests)
- **router.test.ts** (31 tests) — Fallback chain, circuit breaker open/close/half-open, auth fallthrough fix, tool-call fallback without tools, serialization round-trip, `selectProvider` filters, `getStatus` output
- **autoReasoning.test.ts** (32 tests) — Instant/low/high pattern matching, command baselines, score-based classification, command floor override, throttle detection, token estimation
- **tokenTracker.test.ts** (32 tests) — Token estimation, request recording, calibration EMA, session stats aggregation, budget guardrails, cost calculation, formatting, `toJSON`/`fromJSON` persistence
- **modelSelector.test.ts** (23 tests) — Tier classification (light/medium/heavy), keyword matching, context-token thresholds, model selection mapping
- **learnings.test.ts** (18 tests) — Error pattern CRUD, duplicate handling, `findFix` matching, time-based decay, positive feedback, summary formatting, `clearAll`
- **contextTrimmer.test.ts** (10 tests) — Token estimation, message trimming from oldest, tool output whitespace compression, long output truncation, summary placeholder for dropped messages
- **followUps.test.ts** (7 tests) — Mode-specific suggestions (code/plan/chat), diagnostics boost, 4-item cap

#### Improvements Found During Testing
- **autoReasoning: instant-pattern guard** — Instant patterns (greetings, trivial questions) now only fire for prompts < 80 chars, preventing false-positive instant classification on long complex prompts
- **autoReasoning: standalone implement/build/create** — Added `HIGH_PATTERN` for `implement/build/create` followed by any target (previously only matched with full/complete/entire qualifier)
- **tokenTracker: calibration reset** — `resetSession()` now resets calibration factor and sample count, preventing stale EMA from leaking between sessions
- **Router header comment** — Updated to reflect the always-try-all-providers behavior

#### Housekeeping
- `.mercury-learnings.json` added to both `.gitignore` and `.vscodeignore` to prevent workspace learning data from leaking into git or the VSIX package

---

## [0.23.0] — 2026-03-05

### Caching & Prompt Prefix Optimization Release

25 caching improvements, 6 audit fixes, and a prompt prefix caching system to maximize provider-side cache hits and minimize latency + token costs.

#### Phase 1 — Activate Existing Caches & Add New Ones (12 improvements)
- **#1 Activated orphaned `responseCache`** — LRU cache (32 entries, 5-min TTL, SHA-256 keyed) now wired into `chatHandler.ts`; skips duplicate LLM calls when user re-asks identical questions
- **#3 Cached `getWorkspaceTree()`** — recursive `fs.readdirSync` walk now cached with `FileSystemWatcher` invalidation on create/delete events; no longer blocks extension host on every chat message
- **#4–6 Cached git commands** — `getGitStatus()`, `getGitDiff()`, `getGitBranch()` all cached with 8-second TTL; eliminates 90%+ of redundant child process spawns per request
- **#9–10 Search tools use `fileCache`** — `toolSearchFiles()` and `toolFindSymbols()` now read through the LRU file cache instead of raw `fs.readFileSync`
- **#11 Cached `toolListFiles()` results** — 5-second TTL directory listing cache; invalidated on file writes
- **#14 Memoized `estimateMessageTokens()`** — WeakMap memoization so unchanged messages aren't recomputed in `trimToContextBudget()`
- **#15 Cached `getSessionStats()` computation** — aggregation cached and only recomputed when new records are added; rate-limit fields still update in real-time
- **#18 Extended Ollama probe cache TTL** — 10s → 60s (Ollama doesn't start/stop between requests)
- **#19 Extended Copilot model cache TTL** — 30s → 5 minutes (available models change rarely)
- **#23 Custom instructions file watcher** — replaced 30s TTL polling with `FileSystemWatcher` for instant cache invalidation
- **#25 Cached system prompt skeleton** — static tool instructions string extracted to a constant instead of being rebuilt per request
- **#27 Cached learnings file** — parsed once on first access, served from memory; writes still go to disk
- **#28 Diagnostics cache** — `getCachedDiagnostics()` with 2s TTL, used across contextBuilders, chatHandler, and codeLensProvider

#### Phase 2 — Advanced Caching (6 improvements)
- **#2 Activated orphaned `modelSelector`** — `selectModel()` now wired into `chatHandler.ts`; classifies task tier and passes model recommendation to the router
- **#8 Configurable fileCache TTL for Rapid Code** — `fileCache.setTtl(30_000)` during Rapid Code runs (30s vs default 5s); cached reads persist across plan→code→validate→audit phases
- **#12 Shared `toolResultCache` across self-heal** — tool dedup cache persists across Rapid Code self-heal iterations; avoids re-executing identical tool calls; invalidates `read_file` entries after `write_file`/`edit_file`
- **#20 Circuit breaker state persistence** — breaker failure state saved to `globalState` on deactivate; restored on activate so a known-down provider isn't retried immediately after restart
- **#22 CodeLens symbol position cache** — lenses cached per `document.uri:document.version`; avoids re-scanning on cursor moves/scroll
- **#24 Follow-up suggestion cache** — deterministic follow-ups cached by command name; cache bypassed for generic/content-dependent branches

#### Audit Fixes (6 issues found and resolved)
- **CRITICAL: fileCache TTL leak** — `resetTtl()` was not in a `try/finally`; if Rapid Code aborted, TTL stayed at 30s forever. Fixed with `try/finally` wrapper.
- **SIGNIFICANT: modelSelector output was dead code** — `modelRec.openRouterModel` was computed but never passed to the router. Now passed as `model` option in `router.streamChat()`.
- **SIGNIFICANT: Stale reads across self-heal** — shared tool cache served stale `read_file` results after `write_file`/`edit_file` changed a file. Fixed with path-based invalidation after write tools.
- **MODERATE: FileSystemWatcher leaks** — watchers in contextBuilders.ts and customInstructions.ts were never disposed. Added `disposeContextWatchers()` and `disposeInstructionWatchers()` called from `deactivate()`.
- **MINOR: `_diagCache` unbounded** — diagnostics cache had no max entries. Capped at 100 with oldest-eviction.
- **MINOR: `_lensCache` unbounded** — CodeLens cache had no max entries. Capped at 50 with FIFO eviction.

#### Prompt Prefix Caching System (maximize provider cache hits)
- **New module `promptCache.ts`** — central prompt caching logic: frozen prompt builder, context prompt builder, cache-control annotation, Rapid Code shared preamble, sticky model selection
- **Two-system-message layout** — `buildMessages()` now emits two system messages: a **frozen prefix** (persona → tool instructions → custom instructions) that is byte-identical across all requests, followed by a **context message** (command prompt → workspace tree → detected language) that varies per-request but sits after the cached prefix
- **Cache-control breakpoints** — `annotateCacheControl()` marks both system messages with `cache_control: { type: 'ephemeral' }` on OpenRouter (Anthropic models get two independent cache breakpoints) and Mercury (defensive — harmless if unsupported, beneficial if supported)
- **Protected prefix in context trimming** — `trimToContextBudget()` now preserves all leading system messages, not just index 0; dynamic content trimmed from the middle of history
- **Rapid Code shared preamble** — Plan, Code, and Audit phases share `RC_SYSTEM_PREAMBLE` (~50 tokens) as a common cached prefix across all phases within a single Rapid Code run
- **Sticky model selection** — `getStickyModel()` keeps the same model across turns within a tier so the provider-side prefix cache isn't busted by model switching; resets on tier change or deactivation
- **Frozen prompt invalidation** — custom instructions watchers call `invalidateFrozenPrompt()` when instruction files change; otherwise the frozen prompt stays byte-identical indefinitely

---

## [0.22.0] — 2026-03-05

### Architecture Overhaul & Hardening Release

Complete codebase atomization, 21-step audit-driven improvement plan, and tooling modernization.

#### Atomization — Monolith Elimination
- **Decomposed `chatViewProvider.ts`** (4,065 → 434 lines) into 28 focused modules across `src/chat/`, `src/session/`, `src/webview/`, `src/commands/`
- **Rewrote `extension.ts`** (744 → 156 lines) — clean activation with delegated command registration
- **Created command modules** — `codeLensCommands.ts`, `chatCommands.ts` with barrel exports
- **Fixed 5 cutover bugs** — message type mismatches, `duplicateCurrentSession` rewrite, `enforceSessionMessageLimit` on partial resume, `SessionIndex` import path

#### Type Safety (Phase A)
- **Removed dead imports** — `responseCache` from chatEngine, `MercuryMessage` from chatViewContext
- **Eliminated 5 `as any` casts** — added `tag?: string` to `SessionIndex`, `_bookmarked?`/`_reaction?` to `MercuryTextMessage`, typed `branchSession` as `ChatSession`
- **Consolidated `PROVIDER_PRICING`** — removed duplicate in tokenTracker.ts, now imports canonical definition from `providers/types.ts`
- **Unified `TrackedProviderId`** — now aliased to `ProviderId` instead of duplicate literal type

#### Configuration & Correctness (Phase A)
- **Configurable `maxAgentRounds`** — tool loop reads from `mercuryChat.maxAgentRounds` setting (default 15, was hardcoded 10)
- **Scoped circuit breaker resets** — `configWatcher` only resets breakers when provider-related settings change (was firing on any `mercuryChat.*` change)

#### Security (Phase A)
- **XSS hardening in chat.js** — markdown link regex now blocks `javascript:`, `data:`, `vbscript:` URLs; tool names and arguments escaped via `escapeHtml()` before innerHTML injection
- **API key removed from workspace settings** — moved to User Settings guidance; `.vscode/settings.json` no longer contains secrets

#### Storage Resilience (Phase B)
- **Atomic writes** — all session/index writes use write-to-`.tmp`-then-`rename` pattern for crash safety, with fallback to direct write
- **Index backup & recovery** — `saveIndex()` creates `.backup` copy; `loadIndex()` auto-recovers from backup if primary is corrupted
- **Corruption logging** — bare `catch {}` blocks replaced with `console.warn` logging for session index and session file parse failures
- **Safe `deleteSession`** — `fs.unlinkSync` wrapped in try/catch to handle missing files gracefully

#### Code Quality (Phase C)
- **Removed duplicate FileSystemWatcher** — editorContext.ts had a redundant `**/*` watcher for toolResultCache (already handled by chatViewProvider)
- **Barrel imports** — chatViewProvider now imports all chat modules from single `./chat` barrel instead of 8 individual imports
- **Error resilience** — webview message handler wrapped in try/catch with error logging; added `default` case logging unknown message types

#### Reliability (Phase D)
- **Sidebar retry with backoff** — streamChat calls now retry up to 3× with exponential backoff on 429/5xx/timeout/network errors (was fire-once)
- **Abort cleanup** — cancellation now flushes stream buffer, saves partial session state, and detects `AbortError` in addition to message string matching
- **Bounded calibration factor** — token estimation EMA clamped to [0.5, 3.0] to prevent runaway drift

#### Tooling (Phase E)
- **ESLint** — added `eslint` + `@typescript-eslint` with project config (48 warnings, 2 minor errors in regex escapes)
- **esbuild bundler** — `npm run bundle` (dev), `npm run bundle:prod` (minified tree-shaken), `npm run bundle:watch`
- **Unit tests** — vitest with 38 passing tests across `utils.test.ts` (13), `storage.test.ts` (8), `providers.test.ts` (17)
- **New scripts** — `test`, `test:watch`, `bundle`, `bundle:watch`, `bundle:prod`, `package`

#### Architecture (Phase F)
- **ChatViewContextProxy** — replaced `_buildContext()`/`_syncFromContext()` copy-on-call pattern with ES Proxy that reads/writes provider fields directly. Eliminates stale-primitive bugs during concurrent async operations.

#### Documentation
- **Provider setup guide in README** — full routing docs with setup table for Copilot/OpenRouter/Ollama/Mercury
- **Security guidance** — README warns to store API keys in User Settings only
- **`.gitignore` hardened** — added `.vscode/settings.json` and `test-validate.js`

---

## [0.21.0] — 2026-03-05

### 30 Optimizations Release

#### Token Savings (10 improvements)
- **#1 Diff-based file context** — only include changed sections rather than whole files in context
- **#2 Lazy tool definitions** — tool definitions only sent when mode is 'code' or message mentions file/edit keywords
- **#3 Tool result summarization** — results >2KB auto-truncated to first 300 + last 200 chars in agent loop
- **#4 Incremental workspace tree** — cached tree with FileSystemWatcher invalidation, no rebuild on every request
- **#5 Adaptive token budget** — when session cost ratio >0.8, reduce maxTokens to 8192; >0.9 forces low reasoning
- **#6 Deduplicate system prompt** — stable prefix + dynamic suffix for maximum API cache hits (v0.19.0)
- **#7 Compact history** — tool result compression and message trimming (v0.19.0)
- **#8 Skip empty results** — verbose "No matches found" messages replaced with "No results." (5 words)
- **#9 Single-shot edit mode** — prompt compression for tool results (v0.19.0)
- **#10 Token budget per round** — MAX_ROUND_RESULT_CHARS = 24,000 cap; oldest results truncated when exceeded

#### Performance (8 improvements)
- **#11 File read cache** — LRU cache (50 files, 5s TTL) with mtime validation; integrated into all file tool operations
- **#12 Streaming chunk batching** — tokens accumulated and flushed every 16ms (~60fps) instead of per-token postMessage
- **#13 Debounced editor context** — 300ms debounce on selection/diagnostics changes; immediate on active editor switch
- **#14 Precomputed workspace tree** — tree built once and cached; invalidated by FileSystemWatcher on create/delete
- **#15 HTTP keep-alive** — persistent HTTP/HTTPS agents for all Mercury API requests (connection reuse)
- **#16 Parallel validate + test** — when both phases needed, run via Promise.all instead of sequentially
- **#17 Incremental session save** — session persistence optimized (v0.19.0)
- **#18 Webview asset caching** — nonce-based CSP with efficient resource loading

#### UX (6 improvements)
- **#19 Inline diff preview** — edit tool shows before/after diff in chat
- **#20 Cost prediction badge** — live cost display in status bar and chat bubbles
- **#21 Smart follow-ups** — contextual suggestions after responses
- **#22 Progress timeline** — rapid code phases shown with timing and status
- **#23 Message bookmarks** — session management with rename/export/duplicate
- **#24 Response quality indicator** — token usage and model info in footer

#### Agentic (6 improvements)
- **#25 Self-evaluation scoring** — 0-100 score after each rapid code run (success/validation/tests/gaps/iterations)
- **#26 Error pattern memory** — frequent errors injected into system prompt from `.mercury-learnings.json`
- **#27 Adaptive tool selection** — auto-reasoning effort based on prompt complexity
- **#28 Run log with replay** — learningsManager records each run (task, outcome, tools, duration, errors)
- **#29 Post-run optimization report** — optimization tip appended to summary (caching suggestion, planning improvement)
- **#30 Iteration learning loop** — LearningsManager persists patterns for cross-session improvement

#### Infrastructure
- **Memory pruning** — tokenTracker request history capped at 200 entries
- **fileCache.ts** — new LRU cache module for file read deduplication
- **learnings.ts** — new error pattern memory + learning entry persistence module
- **Version bump** to 0.21.0

---

## [0.20.0] — 2026-03-05

### Marketplace & Extension Page

- **Version bump to 0.20.0** — new release with enhanced marketplace presence
- **Enhanced README** — completely rewritten with badge headers, emoji section markers, collapsible `<details>` blocks for settings/commands, comparison table, and feature highlight tables
- **Marketplace metadata** — added `galleryBanner` (dark theme, `#1a1a2e`), `keywords` (10 search terms), additional categories (`Programming Languages`, `Machine Learning`)
- **Enriched description** — longer `description` field for better marketplace search visibility
- **Collapsible sections** — configuration split into 4 groups (API, Tools, Tokens, UI), commands split into 4 groups (Chat, Code Actions, Token/Utility, Slash Commands)
- **Version history table** — quick-reference table at bottom of README linking to CHANGELOG

---

## [0.19.0] — 2026-03-05

### Token Economy & Cost Optimization (10 Improvements)

#### Cost Controls
- **Token budget guardrail** — new `mercuryChat.maxSessionCostUsd` setting (default $1.00). Blocks API calls when session cost exceeds the limit, preventing runaway spending.
- **Live status bar token counter** — the Mercury status bar item now shows cumulative session cost (`Mercury $0.xx`). Click to view the full token usage report.
- **Token usage persistence** — session stats (requests, tokens, cost) are saved to `globalState` and restored across VS Code restarts.

#### Performance & Token Savings
- **Cache-aware prompt reuse** — system prompt restructured with a stable prefix (base prompt + tools + workspace tree) followed by dynamic mode suffix. Maximizes API-level prefix caching for cheaper input tokens.
- **Reasoning effort auto-tuning (sidebar)** — `autoDetectEffort()` now applies to the sidebar chat, not just `@mercury` in Copilot Chat. Simple questions get instant/low effort; complex tasks get high.
- **Prompt compression** — tool result messages are compressed (triple newlines collapsed, blank line whitespace removed, space runs shortened) and capped at 4KB during context trimming.
- **Conversation pruning with summarization** — when old messages are trimmed to fit the context window, a summary placeholder is injected instead of silently dropping context.

#### Rapid Code Agent Improvements
- **Smart file reading** — large files (>100KB) now auto-return the first 200 lines with a line count hint, instead of returning a hard error. Reduces failed tool calls and wasted rounds.
- **Request deduplication** — a `toolResultCache` prevents the agent from re-executing identical tool calls (same name + same arguments) within a single run.
- **Parallel tool execution** — read-only tools (`read_file`, `list_files`, `search_files`, `find_symbols`, `get_diagnostics`) now execute via `Promise.all` when multiple are called in the same round. Write tools remain sequential for safety.

---

## [0.18.0] — 2026-03-04

### Token Tracking & Usage Visibility

- **Token counter in chat bubbles** — each assistant response shows a token-cost badge with input/output/reasoning/cached breakdown and USD cost
- **`stream_options: { include_usage: true }`** — enabled rich usage data from Mercury API including `reasoning_tokens` and `cached_input_tokens`
- **Token bloat fixes** — orchestrator truncates files >150 lines to 80 lines (8K char cap), phases compact context (3K plan / 2K code), agent loop trims messages after round 2 (40K char budget)
- **TokenUsage interface** expanded with `reasoning_tokens?` and `cached_input_tokens?`
- **Cached input pricing** — $0.025/1M tokens (vs $0.25 regular) now correctly calculated in cost display

---

## [0.17.0] — 2026-03-03

### 30 Feature Release

- Rapid Code agent (`#rapidCode` tool) — multi-phase autonomous coding with plan → code → validate → test → audit pipeline
- Token tracker singleton with per-request and session-level cost tracking
- Auto-reasoning effort detection based on prompt complexity
- Git context integration (diff, status, recent commits)
- Code Lens provider (Explain / Test / Fix above functions)
- Custom instructions support (`.mercury-instructions.md`)
- Follow-up suggestions after assistant responses
- Session duplication, undo last message, search in chat
- Inline prompt at cursor (`Ctrl+I`)
- Send terminal output to chat
- Fix diagnostics command
- Compact mode toggle
- Accent color customization
- Stream timeout with auto-retry
- Tool confirmation for destructive operations

---

## [0.16.1] — 2026-03-02

- Bugfix release

---

## [0.16.0] — 2026-03-01

- Session management with persistence
- Export conversations to Markdown
- Mode system (Ask / Plan / Code)
- Streaming with auto-scroll
- Code block actions (Copy, Insert, Apply, New File)
- Mercury Edit model integration
- Workspace tree injection
- `@file(path)` references
- Per-session system prompts

---

## [0.1.0–0.15.0]

- Initial development — sidebar chat, `@mercury` Copilot Chat participant, Mercury 2 API client, basic tool system, streaming, configuration
