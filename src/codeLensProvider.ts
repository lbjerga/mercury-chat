/**
 * codeLensProvider.ts — Mercury Code Lens integration
 *
 * Improvement #16: Show "Mercury: Explain | Test | Fix" above
 * functions, classes, and methods in the editor.
 */

import * as vscode from 'vscode';
import { getCachedDiagnostics } from './contextBuilders';

export class MercuryCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    // #22 Cache lenses per document version to avoid redundant regex parsing
    private _lensCache = new Map<string, { version: number; lenses: vscode.CodeLens[] }>();

    provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.CodeLens[] {
        const config = vscode.workspace.getConfiguration('mercuryChat');
        if (!config.get<boolean>('enableCodeLens', false)) {
            return [];
        }

        // Check lens cache (keyed by URI + document version)
        const cacheKey = document.uri.toString();
        const cached = this._lensCache.get(cacheKey);
        if (cached && cached.version === document.version) {
            return cached.lenses;
        }

        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const lang = document.languageId;

        // #22-b: Hoist diagnostics fetch outside regex loops (was per-match before)
        const diagnostics = getCachedDiagnostics(document.uri);

        // Patterns for function/class/method declarations
        const patterns = this.getPatternsForLanguage(lang);

        for (const pattern of patterns) {
            // #22-c: Respect cancellation token between patterns
            if (_token.isCancellationRequested) { return lenses; }

            let match: RegExpExecArray | null;
            const regex = new RegExp(pattern.regex, 'gm');

            while ((match = regex.exec(text)) !== null) {
                // #22-d: Bail mid-loop on cancellation
                if (_token.isCancellationRequested) { return lenses; }

                const pos = document.positionAt(match.index);
                const range = new vscode.Range(pos, pos);

                // Find the name from the match
                const name = match[pattern.nameGroup || 1] || match[0].trim();

                // Explain lens
                lenses.push(new vscode.CodeLens(range, {
                    title: '$(lightbulb) Explain',
                    command: 'mercuryChat.codeLensExplain',
                    arguments: [document.uri, pos.line, name],
                    tooltip: `Mercury: Explain ${name}`,
                }));

                // Test lens
                if (pattern.type !== 'class') {
                    lenses.push(new vscode.CodeLens(range, {
                        title: '$(beaker) Test',
                        command: 'mercuryChat.codeLensTest',
                        arguments: [document.uri, pos.line, name],
                        tooltip: `Mercury: Generate tests for ${name}`,
                    }));
                }

                // Fix lens (only if there are diagnostics on this range)
                const hasError = diagnostics.some(d =>
                    d.severity === vscode.DiagnosticSeverity.Error &&
                    d.range.start.line >= pos.line &&
                    d.range.start.line <= pos.line + 20
                );
                if (hasError) {
                    lenses.push(new vscode.CodeLens(range, {
                        title: '$(error) Fix',
                        command: 'mercuryChat.codeLensFix',
                        arguments: [document.uri, pos.line, name],
                        tooltip: `Mercury: Fix errors in ${name}`,
                    }));
                }
            }
        }

        // Store in cache before returning
        this._lensCache.set(cacheKey, { version: document.version, lenses });
        // Evict oldest entries if cache exceeds 50 documents
        if (this._lensCache.size > 50) {
            const firstKey = this._lensCache.keys().next().value;
            if (firstKey) { this._lensCache.delete(firstKey); }
        }

        return lenses;
    }

    private getPatternsForLanguage(lang: string): Array<{ regex: string; nameGroup?: number; type?: string }> {
        // Common patterns for popular languages
        switch (lang) {
            case 'typescript':
            case 'typescriptreact':
            case 'javascript':
            case 'javascriptreact':
                return [
                    { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m.source, nameGroup: 1, type: 'function' },
                    { regex: /^(?:export\s+)?class\s+(\w+)/m.source, nameGroup: 1, type: 'class' },
                    { regex: /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/m.source, nameGroup: 1, type: 'function' },
                    { regex: /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/m.source, nameGroup: 1, type: 'function' },
                ];
            case 'python':
                return [
                    { regex: /^(?:async\s+)?def\s+(\w+)/m.source, nameGroup: 1, type: 'function' },
                    { regex: /^class\s+(\w+)/m.source, nameGroup: 1, type: 'class' },
                ];
            case 'java':
            case 'csharp':
            case 'kotlin':
                return [
                    { regex: /^\s*(?:public|private|protected|static|async|override|virtual|abstract|\s)*\s+\w+(?:<[^>]+>)?\s+(\w+)\s*\(/m.source, nameGroup: 1, type: 'function' },
                    { regex: /^\s*(?:public|private|protected|abstract|static|final)?\s*class\s+(\w+)/m.source, nameGroup: 1, type: 'class' },
                ];
            case 'go':
                return [
                    { regex: /^func\s+(?:\([^)]+\)\s+)?(\w+)/m.source, nameGroup: 1, type: 'function' },
                    { regex: /^type\s+(\w+)\s+struct/m.source, nameGroup: 1, type: 'class' },
                ];
            case 'rust':
                return [
                    { regex: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/m.source, nameGroup: 1, type: 'function' },
                    { regex: /^(?:pub\s+)?struct\s+(\w+)/m.source, nameGroup: 1, type: 'class' },
                    { regex: /^(?:pub\s+)?impl(?:<[^>]+>)?\s+(\w+)/m.source, nameGroup: 1, type: 'class' },
                ];
            default:
                return [
                    { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m.source, nameGroup: 1, type: 'function' },
                    { regex: /^(?:export\s+)?class\s+(\w+)/m.source, nameGroup: 1, type: 'class' },
                ];
        }
    }

    refresh(): void {
        this._lensCache.clear();
        this._onDidChangeCodeLenses.fire();
    }
}
