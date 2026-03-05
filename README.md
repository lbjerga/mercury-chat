# +Lars — AI Chat Tool (Mercury 2)

> **The fastest AI coding assistant for VS Code** — powered by Inception Mercury 2, the world's fastest reasoning LLM.

[![Version](https://img.shields.io/badge/version-0.23.0-7c6bf5?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=lars-bjerga.mercury-chat)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](https://opensource.org/licenses/MIT)
[![Mercury 2](https://img.shields.io/badge/model-Mercury%202-ff6b35?style=flat-square)](https://www.inceptionlabs.ai/)
[![VS Code](https://img.shields.io/badge/vscode-%5E1.93.0-007ACC?style=flat-square)](https://code.visualstudio.com/)

---

## 🎯 Why +Lars?

No Copilot subscription needed. Bring your own Mercury API key and get a **complete AI coding experience** — faster responses, lower cost, full control.

| | GitHub Copilot Chat | **+Lars AI Chat** |
|---|---|---|
| 💰 Monthly cost | $10–39/mo | **Free** (BYOK) |
| ⚡ Model | GPT-4o / Claude | **Mercury 2** — near-instant |
| 🔧 Tool calling | Yes | **Yes** — 10 built-in tools |
| 💾 Chat persistence | Session only | **Full disk persistence** |
| 💵 Token budget | No | **Yes** — per-session guardrail |
| 🧠 Auto-reasoning | No | **Yes** — effort auto-tuned |
| 🤖 Agentic coding | Basic | **Rapid Code** — 5-phase pipeline |
| 📊 Cost tracking | No | **Live** — status bar + badges |
| 📁 Session management | No | **Full** — rename, export, duplicate |
| 🔓 Open source | No | **Yes** |

---

## ✨ Feature Highlights

### 🖥️ Dual Interface

Use Mercury 2 whichever way suits you:

- **`@mercury` in Copilot Chat** — use Mercury right alongside GPT/Claude/Gemini in VS Code's built-in Chat panel
- **Standalone Sidebar** — full-featured chat with sessions, tools, streaming, and cost tracking

---

### 🤖 Rapid Code Agent

Autonomous multi-phase coding agent available as `#rapidCode` in both the sidebar and Copilot Chat.

```
📋 Plan → 💻 Code → ✅ Validate → 🧪 Test → 🔍 Audit
```

| Capability | Detail |
|---|---|
| Multi-phase pipeline | Plan → Code → Validate → Test → Audit |
| Tools | 10 tools: read, write, edit, search, list, run, symbols, diagnostics |
| Parallel execution | Read-only tools run via `Promise.all` |
| Request dedup | Identical tool calls cached within a run |
| Smart file reading | Large files auto-preview first 200 lines |
| Context compaction | Message trimming + prompt compression |
| Self-healing | Auto-retries on compile errors |
| Self-evaluation | 0-100 score per run (success, validation, tests) |
| Parallel validate+test | Phases run concurrently when both enabled |
| Learning memory | Error patterns + learnings persisted across sessions |
| Optimization tips | Post-run suggestions for improving efficiency |

---

### ⚡ v0.21.0 — 30 Optimizations

| Category | Count | Highlights |
|---|---|---|
| Token Savings | 10 | Lazy tool defs, result summarization, round budget cap, adaptive budget |
| Performance | 8 | File cache, streaming batching, parallel phases, HTTP keep-alive |
| UX | 6 | Cost tracking, diff preview, progress timeline, follow-ups |
| Agentic | 6 | Self-eval scoring, error memory, run logging, optimization tips |

---

### 🔧 Tool System

Mercury 2 can autonomously interact with your codebase through 10 built-in tools:

| Tool | Description |
|---|---|
| 📄 `read_file` | Read file contents (line ranges, smart large-file preview) |
| ✏️ `write_file` | Create or overwrite files |
| 🔀 `edit_file` | Targeted edits via Mercury Edit's Apply endpoint |
| 📂 `list_files` | List directory contents (recursive) |
| 🔍 `search_files` | Regex/text search across workspace |
| ▶️ `run_command` | Execute shell commands (build, test, git) |
| 🏷️ `find_symbols` | Find symbols in workspace |
| ⚠️ `get_diagnostics` | Get compiler/linter errors |
| ↩️ `undo_edit` | Undo the last file edit |
| 🚀 `run_rapid_code` | Invoke the Rapid Code agent |

> **Safety first:** Destructive tools (write, edit, run) require user approval before executing.

---

### 💰 Token Economy & Cost Controls

Complete visibility and control over your API spend:

| Feature | Description |
|---|---|
| **Live status bar** | Shows `Mercury $0.xx` — click for full report |
| **Budget guardrail** | `maxSessionCostUsd` blocks requests when exceeded |
| **Token badges** | Each response: input / output / reasoning / cached + cost |
| **Persistence** | Stats survive VS Code restarts |
| **Cache-aware prompts** | Stable prefix maximizes $0.025/1M cached pricing |
| **Auto-reasoning** | Simple = instant effort, complex = high effort |
| **Prompt compression** | Tool results compressed and capped at 4KB |
| **Smart pruning** | Dropped messages get summary placeholders |

**Pricing (per 1M tokens):**

| | Input | Cached Input | Output |
|---|---|---|---|
| Mercury 2 | $0.25 | $0.025 | $0.75 |
| Mercury Edit | $0.25 | $0.025 | $0.75 |

---

### 💾 Sessions & Persistence

- **Sessions survive VS Code restarts** — conversations saved to disk
- **Webview retained when hidden** — switching tabs preserves chat state
- **State restoration** — input, mode, scroll position all persist
- **Session sidebar** — always-visible panel with rename, delete, duplicate
- **Export to Markdown** — save any conversation as `.md`

---

### 🎨 Code Block Actions

Every assistant code block includes hover buttons:

| Action | What it does |
|---|---|
| 📋 **Copy** | Copy to clipboard |
| ➡️ **Insert** | Insert at cursor in active editor |
| 🔀 **Apply** | Replace selected text (or insert) |
| 📄 **New File** | Open in new untitled file with language detection |

---

### 🎛️ Mode System

Switch modes with the dropdown or `Shift+Tab`:

| Mode | Behavior |
|---|---|
| 💬 **Ask** | General questions and explanations |
| 📋 **Plan** | Architecture thinking — step-by-step, no code unless asked |
| 💻 **Code** | Generates and edits files using tools |

---

### ⚡ Streaming & Performance

- Real-time token streaming with typing indicator
- Smart auto-scroll with scroll-to-bottom button
- Token sliding window — trims old messages automatically
- Auto-retry on transient network errors

---

### 🧠 Mercury 2 API Integration

| Feature | Detail |
|---|---|
| Reasoning effort | instant / low / medium / high |
| Temperature | 0.5–1.0 per Mercury spec |
| Context window | 128K (chat), 32K (edits) |
| Tool calling | Native OpenAI-compatible function calling |
| Streaming | SSE with `stream_options: { include_usage: true }` |
| Usage data | prompt_tokens, completion_tokens, reasoning_tokens, cached_input_tokens |

---

## 🚀 Quick Start

### 1. Install

```bash
# From source
npm install
npm run compile
npx @vscode/vsce package --allow-missing-repository
# Then: Extensions → ... → Install from VSIX
```

### 2. Set Your API Keys

> ⚠️ **Always store API keys in User Settings (global), not Workspace Settings**, so they're never committed to git.

Open the Command Palette (`Ctrl+Shift+P`) and run:

> **Mercury Chat: Set API Key**

Or configure manually — press `Ctrl+,` → search `mercuryChat` → set keys in the **User** tab (not Workspace):

| Setting | Where to get it |
|---|---|
| `mercuryChat.apiKey` | [inceptionlabs.ai](https://www.inceptionlabs.ai/) — Mercury 2 API key |
| `mercuryChat.openRouterApiKey` | [openrouter.ai/keys](https://openrouter.ai/keys) — OpenRouter API key |
| `mercuryChat.ollamaEndpoint` | Default: `http://localhost:11434/v1` — auto-detected if Ollama is running |

#### Provider Routing

The extension uses a **smart provider router** with automatic fallback. Configure the priority order:

```jsonc
// User Settings (Ctrl+, → JSON)
{
    "mercuryChat.routeOrder": ["copilot", "openrouter", "ollama", "mercury"],
    "mercuryChat.apiKey": "sk_your_mercury_key",
    "mercuryChat.openRouterApiKey": "sk-or-your_openrouter_key",
    "mercuryChat.openRouterModel": "google/gemini-2.0-flash-001",
    "mercuryChat.ollamaModel": "llama3.1"
}
```

| Provider | Setup | Cost |
|---|---|---|
| **Copilot** | Just have GitHub Copilot installed | Free (with Copilot sub) |
| **OpenRouter** | Add `openRouterApiKey` | Pay-per-token (varies by model) |
| **Ollama** | Run `ollama serve` locally | Free (local) |
| **Mercury** | Add `apiKey` | Pay-per-token |

The router tries each provider in order. If one fails or is unavailable, it automatically falls through to the next.

### 3. Start Chatting

- Click the **+Lars** icon in the Activity Bar
- Or type `@mercury` in VS Code's Chat panel

---

## ⚙️ Configuration

<details>
<summary><b>🔑 API & Model Settings</b></summary>

| Setting | Default | Description |
|---|---|---|
| `mercuryChat.apiKey` | `""` | Your Inception Mercury 2 API key |
| `mercuryChat.apiBaseUrl` | `https://api.inceptionlabs.ai/v1` | API base URL |
| `mercuryChat.model` | `mercury-2` | Chat model (128K context) |
| `mercuryChat.temperature` | `0.6` | Response randomness (0.5–1.0) |
| `mercuryChat.reasoningEffort` | `medium` | Reasoning depth: instant / low / medium / high |
| `mercuryChat.autoReasoningEffort` | `true` | Auto-adjust reasoning per prompt |
| `mercuryChat.maxTokens` | `32768` | Maximum tokens in response |

</details>

<details>
<summary><b>🌐 Provider Routing</b></summary>

| Setting | Default | Description |
|---|---|---|
| `mercuryChat.routeOrder` | `["copilot","openrouter","ollama","mercury"]` | Provider fallback chain |
| `mercuryChat.openRouterApiKey` | `""` | OpenRouter API key |
| `mercuryChat.openRouterModel` | `google/gemini-2.0-flash-001` | Default OpenRouter model |
| `mercuryChat.openRouterTimeout` | `60000` | OpenRouter streaming timeout (ms) |
| `mercuryChat.ollamaEndpoint` | `http://localhost:11434/v1` | Local Ollama endpoint |
| `mercuryChat.ollamaModel` | `llama3.1` | Default Ollama model |
| `mercuryChat.ollamaTimeout` | `120000` | Ollama streaming timeout (ms) |
| `mercuryChat.copilotModelFamily` | `gpt-4o` | Preferred Copilot model family |

> 🔑 **Security:** Store `apiKey` and `openRouterApiKey` in **User Settings only** — never in `.vscode/settings.json` which may be committed to git.

</details>

<details>
<summary><b>🔧 Tools & Behavior</b></summary>

| Setting | Default | Description |
|---|---|---|
| `mercuryChat.enableTools` | `true` | Enable tool use in sidebar |
| `mercuryChat.useEditModelForEdits` | `true` | Use Mercury Edit for `edit_file` |
| `mercuryChat.editModel` | `mercury-edit` | Model for edit operations |
| `mercuryChat.confirmDestructiveTools` | `true` | Ask before write/edit/run |
| `mercuryChat.maxAgentRounds` | `15` | Max tool-call rounds per request |
| `mercuryChat.enableCodeLens` | `true` | Show Code Lens above functions |
| `mercuryChat.enableGitContext` | `true` | Include git context |

</details>

<details>
<summary><b>💰 Token Economy</b></summary>

| Setting | Default | Description |
|---|---|---|
| `mercuryChat.maxContextTokens` | `16000` | Max tokens in conversation context |
| `mercuryChat.maxSessionCostUsd` | `1.00` | Budget guardrail — max session cost (0 = off) |
| `mercuryChat.streamTimeout` | `30000` | Stream timeout in ms |
| `mercuryChat.autoRetry` | `true` | Auto-retry on transient errors |

</details>

<details>
<summary><b>🎨 UI & Preferences</b></summary>

| Setting | Default | Description |
|---|---|---|
| `mercuryChat.systemPrompt` | *(built-in)* | Global system prompt |
| `mercuryChat.autoInjectWorkspace` | `true` | Auto-include workspace tree |
| `mercuryChat.accentColor` | `#7c6bf5` | UI accent color |
| `mercuryChat.compactMode` | `false` | Compact chat layout |
| `mercuryChat.followUpSuggestions` | `true` | Show follow-up suggestions |

</details>

---

## ⌨️ Commands & Shortcuts

<details>
<summary><b>💬 Chat Commands</b></summary>

| Command | Shortcut | Description |
|---|---|---|
| New Chat | `Ctrl+L` | Start a new conversation |
| Set API Key | — | Store your API key |
| Clear History | — | Clear current session |
| Toggle Sessions Panel | `Ctrl+Shift+M` | Toggle session sidebar |
| Export Conversation | — | Export to Markdown |
| Show Shortcuts | — | Keyboard shortcut overlay |
| Toggle Compact Mode | — | Toggle compact layout |

</details>

<details>
<summary><b>✏️ Code Actions</b></summary>

| Command | Shortcut | Description |
|---|---|---|
| Send Selection | — | Send selected code to chat |
| Explain Selection | — | Explain selected code |
| Fix Selection | — | Fix bugs in selected code |
| Test Selection | — | Generate tests |
| Generate Docs | — | Generate documentation |
| Inline Prompt | `Ctrl+I` | Prompt at cursor |
| Fix Diagnostics | — | Fix compiler/linter errors |

</details>

<details>
<summary><b>📊 Token & Utility</b></summary>

| Command | Description |
|---|---|
| Show Token Usage | View detailed token & cost report |
| Reset Token Stats | Reset session counters |
| Cycle Reasoning Effort | Cycle instant → low → medium → high |
| Generate Commit Message | Conventional commit from git diff |
| Send Terminal Output | Send terminal content to chat |

</details>

<details>
<summary><b>🎯 Slash Commands (@mercury)</b></summary>

| Command | Description |
|---|---|
| `/explain` | Explain selected code or concept |
| `/fix` | Diagnose and fix bugs |
| `/review` | Code review for quality and performance |
| `/test` | Generate unit tests |
| `/doc` | Generate documentation |

</details>

---

## 📁 Project Structure

<details>
<summary><b>View full structure</b></summary>

```
mercury-chat/
├── src/
│   ├── extension.ts           # Entry point — registers providers & commands
│   ├── chatViewProvider.ts    # Sidebar webview — HTML/CSS/JS, chat logic, tools
│   ├── chatHandler.ts         # @mercury Copilot Chat participant handler
│   ├── mercuryClient.ts       # Mercury 2 API client (streaming, chat, apply-edit)
│   ├── tokenTracker.ts        # Token & cost tracking (singleton, persistent)
│   ├── autoReasoning.ts       # Auto-adjust reasoning effort per request
│   ├── contextBuilders.ts     # Message building & intent detection
│   ├── codeLensProvider.ts    # Explain/Test/Fix Code Lens
│   ├── gitContext.ts          # Git diff & status context
│   ├── customInstructions.ts  # .mercury-instructions.md support
│   ├── followUps.ts           # Follow-up suggestion generation
│   ├── outputChannel.ts       # Output channel logging
│   ├── storage.ts             # Chat session persistence
│   ├── prompts.ts             # Prompt templates
│   ├── types.ts               # TypeScript interfaces
│   ├── utils.ts               # Shared utilities
│   ├── rapidCode/
│   │   ├── index.ts           # Rapid Code entry point
│   │   ├── orchestrator.ts    # Multi-phase orchestrator
│   │   ├── phases.ts          # Plan/code/validate/test/audit phases
│   │   ├── agentLoop.ts       # Agent loop (parallel exec, dedup, trimming)
│   │   └── lmTool.ts          # Language model tool registration
│   └── tools/
│       ├── index.ts           # Tool exports
│       ├── definitions.ts     # OpenAI-compatible tool definitions
│       ├── executor.ts        # Tool dispatch
│       ├── fileTools.ts       # read/write/edit file (smart preview)
│       ├── searchTools.ts     # search_files, find_symbols
│       ├── commandTool.ts     # run_command
│       ├── vscodeTools.ts     # get_diagnostics, undo_edit
│       ├── rapidCodeTool.ts   # Rapid Code integration
│       └── helpers.ts         # Tool utilities
├── media/                     # Extension icon (SVG)
├── public/                    # Logo assets
├── package.json               # Extension manifest (22+ settings)
├── CHANGELOG.md               # Version history
└── tsconfig.json              # TypeScript config
```

</details>

---

## 🔧 Development

```bash
npm install           # Install dependencies
npm run compile       # Build once
npm run watch         # Build in watch mode (F5 to debug)
```

Press **F5** to launch the Extension Development Host.

### Building

```bash
npx @vscode/vsce package --allow-missing-repository
```

Install via **Extensions → … → Install from VSIX**.

---

## 📋 Version History

See the full [CHANGELOG](CHANGELOG.md) for detailed release notes.

| Version | Date | Highlights |
|---|---|---|
| **0.20.0** | 2026-03-05 | Marketplace optimization, enhanced extension page |
| **0.19.0** | 2026-03-05 | 10 token economy improvements — budget, persistence, parallel tools |
| **0.18.0** | 2026-03-04 | Token cost badges, stream_options, bloat fixes |
| **0.17.0** | 2026-03-03 | Rapid Code agent, 30-feature release |
| **0.16.0** | 2026-03-01 | Sessions, modes, code actions, Mercury Edit |

---

## 📄 License

MIT — free to use, modify, and distribute.

---

**Made with ⚡ by Lars Bjerga — powered by [Inception Mercury 2](https://www.inceptionlabs.ai/)**
