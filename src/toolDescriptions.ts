/**
 * toolDescriptions.ts — Human-readable tool call summaries for chat UI
 */

/** Describe a tool call in a friendly way for streaming progress */
export function describeToolCall(name: string, rawArgs: string): string {
    try {
        const args = JSON.parse(rawArgs);
        switch (name) {
            case 'read_file': {
                const p = args.path || '?';
                const range = args.startLine && args.endLine ? ` (lines ${args.startLine}–${args.endLine})` : '';
                return `Reading **${p}**${range}`;
            }
            case 'write_file':
                return `Writing to **${args.path || '?'}**`;
            case 'edit_file':
                return `Editing **${args.path || '?'}**`;
            case 'list_files': {
                const dir = args.path || '.';
                return `Listing files in **${dir}**${args.recursive ? ' (recursive)' : ''}`;
            }
            case 'search_files': {
                const pat = args.pattern || '?';
                const scope = args.path ? ` in ${args.path}` : '';
                return `Searching for \`${pat}\`${scope}`;
            }
            case 'find_symbols': {
                const pat = args.pattern || '?';
                return `Finding symbols matching \`${pat}\``;
            }
            case 'get_diagnostics':
                return `Getting workspace diagnostics/errors`;
            case 'open_file':
                return `Opening **${args.path || '?'}** in editor`;
            case 'run_command':
                return `Running command: \`${(args.command || '?').slice(0, 80)}\``;
            case 'rapid_code':
                return `🚀 Rapid Code: **${(args.task || '?').slice(0, 80)}**`;
            default:
                return `Running tool **${name}**`;
        }
    } catch {
        return `Running tool **${name}**`;
    }
}

/** Short summary of a tool result for display */
export function summarizeToolResult(name: string, rawArgs: string, content: string, isError: boolean): string {
    if (isError) {
        return `⚠️ ${content.slice(0, 200)}`;
    }
    try {
        switch (name) {
            case 'read_file': {
                const header = content.split('\n')[0] || '';
                return `✅ ${header}`;
            }
            case 'write_file':
            case 'edit_file':
                return `✅ ${content.split('\n')[0]}`;
            case 'list_files':
                return `✅ ${content.split('\n')[0]}`;
            case 'search_files':
            case 'find_symbols':
                return `✅ ${content.split('\n')[0]}`;
            case 'get_diagnostics':
                return `✅ ${content.split('\n')[0]}`;
            case 'open_file':
                return `✅ ${content}`;
            case 'rapid_code':
                return `🚀 ${content.split('\n').find(l => l.startsWith('**Status:**')) || 'Rapid Code finished'}`;
            case 'run_command': {
                const outLines = content.split('\n').filter(l => l.trim());
                const preview = outLines.slice(0, 3).join('\n');
                return `✅ Command finished (${outLines.length} lines)${preview ? '\n```\n' + preview + '\n```' : ''}`;
            }
            default:
                return `✅ Done (${content.length} chars)`;
        }
    } catch {
        return `✅ Done`;
    }
}
