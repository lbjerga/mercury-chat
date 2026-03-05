# Architecture

Mercury Chat is a VS Code extension that provides a full-featured AI coding assistant with multiple LLM provider support.

## High-Level Components

```
┌──────────────────────────────────────────────────────────┐
│  VS Code Extension Host                                  │
│                                                          │
│  extension.ts ─── activation, registration, wiring       │
│       │                                                  │
│       ├── chatHandler.ts ──── @mercury Chat Participant  │
│       │        └──  Copilot Chat panel integration       │
│       │                                                  │
│       ├── chatViewProvider.ts ── Sidebar webview host     │
│       │        └── chat/chatEngine.ts ── core chat loop  │
│       │                                                  │
│       ├── providers/router.ts ── multi-provider router   │
│       │        ├── copilotProvider.ts  (vscode.lm API)   │
│       │        ├── openRouterProvider.ts (HTTP/SSE)      │
│       │        ├── ollamaProvider.ts    (HTTP/SSE)       │
│       │        └── mercuryProvider.ts   (MercuryClient)  │
│       │                                                  │
│       ├── rapidCode/ ── autonomous agent pipeline        │
│       ├── tools/     ── 10 built-in tools                │
│       ├── session/   ── session persistence              │
│       └── commands/  ── VS Code command registrations    │
└──────────────────────────────────────────────────────────┘
```

## Provider Router

The `ProviderRouter` manages a configurable fallback chain:

1. **Copilot** — 0 credits, fastest (uses `vscode.lm` API)
2. **OpenRouter** — thousands of models via API key
3. **Ollama** — local, free, runs on user hardware
4. **Mercury** — Inception Mercury 2 API

On each request:
- Skip providers whose circuit breaker is OPEN
- Skip providers that aren't available (missing API key, etc.)
- Try the first eligible provider
- On failure → always try next provider in chain
- Only transient errors (rate-limit, timeout, 5xx, network) trip the circuit breaker

## Chat Engine (Sidebar)

`chat/chatEngine.ts` handles:
- User message → context expansion (@file, @workspace, @selection)
- Tool call loop (up to 15 rounds)
- Token budget management
- Auto-reasoning effort detection
- Follow-up suggestion generation
- Learnings integration

## Rapid Code Agent

`rapidCode/` implements an autonomous coding pipeline:
- **Plan** → **Code** → **Validate** → **Test** → **Audit**
- Self-healing loop with gap analysis
- Modes: quick, validate, test, full

## Key Modules

| Module | Purpose |
|--------|---------|
| `tokenTracker.ts` | Per-request & session token/cost tracking |
| `autoReasoning.ts` | Auto-adjust reasoning effort per prompt |
| `modelSelector.ts` | Classify task complexity → model tier |
| `contextTrimmer.ts` | Trim messages to fit token budget |
| `fileCache.ts` | LRU cache for file reads |
| `learnings.ts` | Error pattern learning & recall |
| `i18n.ts` | Internationalisation strings |
| `utils/logger.ts` | Levelled structured logger |
| `utils/safeAsync.ts` | Async error boundaries |
