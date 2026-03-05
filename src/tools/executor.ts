/**
 * tools/executor.ts — Tool call dispatcher
 */

import { ToolCall, ToolResult } from '../types';
import { toolReadFile, toolWriteFile, toolEditFile, toolListFiles } from './fileTools';
import { toolSearchFiles, toolFindSymbols } from './searchTools';
import { toolRunCommand } from './commandTool';
import { toolGetDiagnostics, toolOpenFile } from './vscodeTools';
import { toolRapidCode } from './rapidCodeTool';
import { toolResultCache } from './toolCache';
import type { ProviderRouter } from '../providers';

/**
 * Executes a single tool call and returns the result.
 */
/** Set of read-only tools that can safely run in parallel */
export const READ_ONLY_TOOLS = new Set(['read_file', 'search_files', 'list_files', 'find_symbols', 'get_diagnostics', 'open_file']);

export async function executeTool(
    call: ToolCall,
    workspaceRoot: string,
    router?: ProviderRouter
): Promise<ToolResult> {
    const name = call.function.name;
    let args: Record<string, unknown>;
    try {
        args = JSON.parse(call.function.arguments);
    } catch {
        return {
            toolCallId: call.id,
            name,
            content: `Error: Invalid JSON arguments: ${call.function.arguments}`,
            isError: true,
        };
    }

    // ═══ Tool result cache: return cached result for read-only tools ═══
    if (READ_ONLY_TOOLS.has(name)) {
        const cached = toolResultCache.get(name, call.function.arguments);
        if (cached) {
            return { toolCallId: call.id, name, content: cached.result, isError: cached.isError };
        }
    }

    try {
        let result: ToolResult;
        switch (name) {
            case 'read_file':
                result = { toolCallId: call.id, name, ...await toolReadFile(workspaceRoot, args) }; break;
            case 'write_file': {
                result = { toolCallId: call.id, name, ...await toolWriteFile(workspaceRoot, args) };
                // Invalidate cache for written path
                const writePath = args.path as string;
                if (writePath) toolResultCache.invalidatePath(writePath);
                break;
            }
            case 'edit_file': {
                result = { toolCallId: call.id, name, ...await toolEditFile(workspaceRoot, args, router) };
                // Invalidate cache for edited path
                const editPath = args.path as string;
                if (editPath) toolResultCache.invalidatePath(editPath);
                break;
            }
            case 'list_files':
                result = { toolCallId: call.id, name, ...await toolListFiles(workspaceRoot, args) }; break;
            case 'search_files':
                result = { toolCallId: call.id, name, ...await toolSearchFiles(workspaceRoot, args) }; break;
            case 'run_command': {
                result = { toolCallId: call.id, name, ...await toolRunCommand(workspaceRoot, args) };
                // Commands may modify files — broad invalidation
                toolResultCache.clear();
                break;
            }
            case 'find_symbols':
                result = { toolCallId: call.id, name, ...await toolFindSymbols(workspaceRoot, args) }; break;
            case 'get_diagnostics':
                result = { toolCallId: call.id, name, ...await toolGetDiagnostics(workspaceRoot, args) }; break;
            case 'open_file':
                result = { toolCallId: call.id, name, ...await toolOpenFile(workspaceRoot, args) }; break;
            case 'rapid_code':
                result = { toolCallId: call.id, name, ...await toolRapidCode(args) }; break;
            default:
                return { toolCallId: call.id, name, content: `Unknown tool: ${name}`, isError: true };
        }

        // ═══ Cache read-only tool results ═══
        if (READ_ONLY_TOOLS.has(name)) {
            toolResultCache.set(name, call.function.arguments, result.content, result.isError);
        }
        return result;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { toolCallId: call.id, name, content: `Error executing ${name}: ${msg}`, isError: true };
    }
}
