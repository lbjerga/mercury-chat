/**
 * i18n.ts — Internationalisation support
 *
 * Improvement #17: Extracts all user-facing UI strings into a single
 * module with a default English translation. Future locales can
 * override keys by providing a JSON file and calling `i18n.load()`.
 *
 * Usage:
 *   import { t } from './i18n';
 *   stream.markdown(t('noProvider'));
 */

// ──────────────────────────────────────────────
// Default English strings
// ──────────────────────────────────────────────

const EN: Record<string, string> = {
    // Provider / router
    'noProvider': '⚠️ **No provider available.** Configure at least one provider in Settings.',
    'noProviderDetail':
        '• **Copilot** — install GitHub Copilot extension and sign in\n' +
        '• **OpenRouter** — set `mercuryChat.openRouterApiKey`\n' +
        '• **Ollama** — run `ollama serve` locally\n' +
        '• **Mercury** — set `mercuryChat.apiKey`\n\n' +
        'Then adjust `mercuryChat.routeOrder` to set fallback priority.',
    'allProvidersFailed': '⚠️ All providers failed. Last error: {error}',
    'retryMessage': 'Retrying with next provider…',

    // Chat
    'welcome.title': '+Lars AI Chat',
    'welcome.subtitle': 'Ask Mercury 2 anything about coding.',
    'welcome.poweredBy': 'Powered by Inception — no Copilot credits used.',
    'welcome.tip.ask': 'Ask · questions & explanations',
    'welcome.tip.plan': 'Plan · architecture & design',
    'welcome.tip.code': 'Code · generate & edit files',
    'welcome.contextHint': 'Tip: use @file(path), @workspace, @selection, @problems',

    // Quick actions
    'action.explain': 'Explain',
    'action.fix': 'Fix',
    'action.refactor': 'Refactor',
    'action.test': 'Test',
    'action.review': 'Review',
    'action.optimize': 'Optimize',
    'action.docs': 'Docs',

    // Input
    'input.placeholder': 'Ask Mercury anything…',
    'input.send': 'Send',
    'input.stop': 'Stop',

    // Sessions
    'session.title': 'Sessions',
    'session.new': 'New Chat',
    'session.clearAll': 'Clear All',
    'session.searchPlaceholder': 'Search sessions…',
    'session.rename': 'Rename Chat',
    'session.renameCancel': 'Cancel',
    'session.renameSave': 'Save',

    // Errors
    'error.streamStalled': 'Stream stalled — no data for {seconds}s.',
    'error.cancelled': 'Request was cancelled.',
    'error.generic': 'Something went wrong: {message}',

    // Tool confirmation
    'tool.allowTitle': 'Allow {name}?',
    'tool.deny': 'Deny',
    'tool.allow': 'Allow',

    // Status bar
    'status.tokens': '{count} tokens',
    'status.cost': '${cost}',

    // CodeLens
    'codelens.explain': 'Explain',
    'codelens.test': 'Test',
    'codelens.fix': 'Fix',
};

// ──────────────────────────────────────────────
// Runtime state
// ──────────────────────────────────────────────

let _strings: Record<string, string> = { ...EN };

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

/**
 * Translate a key.
 * Interpolation: `t('error.streamStalled', { seconds: '30' })`
 */
export function t(key: string, vars?: Record<string, string>): string {
    let text = _strings[key] ?? key;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            text = text.replaceAll(`{${k}}`, v);
        }
    }
    return text;
}

/** Load or merge a locale JSON object (partial overrides are fine). */
export function loadLocale(strings: Record<string, string>): void {
    _strings = { ...EN, ...strings };
}

/** Reset to English defaults. */
export function resetLocale(): void {
    _strings = { ...EN };
}

/** Get all keys (useful for tests / tooling). */
export function allKeys(): string[] {
    return Object.keys(EN);
}
