# Contributing to Mercury Chat

## Getting Started

```bash
git clone https://github.com/<your-org>/mercury-chat.git
cd mercury-chat
npm install
npm run compile
```

## Development Workflow

1. **Compile**: `npm run compile` (tsc)
2. **Watch**: `npm run watch` (auto-recompile on save)
3. **Lint**: `npm run lint` / `npm run lint:fix`
4. **Format**: `npm run format` (Prettier)
5. **Type-check**: `npm run typecheck` (tsc --noEmit)
6. **Test**: `npm run test` (vitest)
7. **Package**: `npx vsce package --no-git-tag-version --baseContentUrl "https://example.com" --baseImagesUrl "https://example.com"`

## Debug in VS Code

Press **F5** to launch the Extension Development Host. The extension will load from the `out/` directory.

## Project Structure

```
src/
├── extension.ts          # Entry point (activation/deactivation)
├── chatHandler.ts        # @mercury Chat Participant handler
├── chatViewProvider.ts   # Sidebar webview host
├── chat/                 # Chat engine, context trimmer, tools
├── providers/            # Multi-provider router + adapters
├── tools/                # 10 built-in tools (file, search, etc.)
├── rapidCode/            # Autonomous coding agent
├── commands/             # VS Code command registrations
├── session/              # Session persistence
├── webview/              # HTML, CSS, JS for the sidebar UI
├── utils/                # Logger, safeAsync, shared helpers
├── types/                # Public type definitions
└── i18n.ts               # Internationalisation strings
```

## Code Style

- **TypeScript** strict mode, ES2022 target
- **ESLint** + **Prettier** — run `npm run lint:fix && npm run format` before committing
- Prefer `const` over `let`, avoid `any` where possible
- Use the structured `logger` (from `src/utils/logger.ts`) instead of `console.log`
- Wrap async entry points in `safeAsync`/`safeRun` (from `src/utils/safeAsync.ts`)

## Testing

Tests use **vitest** and are co-located with source files (`*.test.ts`).

```bash
npm run test          # run all tests
npm run test:watch    # watch mode
```

Aim for ≥80% coverage on core utilities.

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add OpenRouter provider fallback
fix: router now tries all providers on auth errors
test: add 31 router tests
docs: add architecture.md
```

## Pull Requests

- Create a feature branch from `master`
- Include tests for new functionality
- Ensure `npm run precommit` passes (typecheck + lint + test)
- Update `CHANGELOG.md` with your changes
