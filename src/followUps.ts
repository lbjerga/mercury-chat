/**
 * followUps.ts — Smart follow-up suggestion generation
 */

import * as vscode from 'vscode';

// #24 Cache deterministic follow-ups by command (they never change)
const _followUpCache = new Map<string, vscode.ChatFollowup[]>();

export function generateFollowUps(
    command: string | undefined,
    prompt: string,
    responseContent: string
): vscode.ChatFollowup[] {
    // For known commands, follow-ups are deterministic — cache them
    if (command && command !== '') {
        const cached = _followUpCache.get(command);
        if (cached) { return cached; }
    }
    const followUps: vscode.ChatFollowup[] = [];

    if (command === 'explain') {
        followUps.push(
            { prompt: 'Can you simplify this further?', label: 'Simplify' },
            { prompt: 'Show me usage examples', label: 'Examples' },
            { prompt: 'What are the edge cases?', label: 'Edge cases' },
        );
    } else if (command === 'fix') {
        followUps.push(
            { prompt: 'Add error handling to make this more robust', label: 'Add error handling' },
            { prompt: 'Write tests to verify the fix', label: 'Write tests' },
            { prompt: 'Are there any other potential issues?', label: 'More issues?' },
        );
    } else if (command === 'review') {
        followUps.push(
            { prompt: 'Apply the suggested improvements', label: 'Apply fixes' },
            { prompt: 'Focus on security concerns', label: 'Security review' },
            { prompt: 'Check for performance bottlenecks', label: 'Perf review' },
        );
    } else if (command === 'test') {
        followUps.push(
            { prompt: 'Add integration tests', label: 'Integration tests' },
            { prompt: 'Add edge case tests', label: 'Edge cases' },
            { prompt: 'Set up test scaffolding (describe/it blocks)', label: 'Test scaffold' },
        );
    } else if (command === 'refactor') {
        followUps.push(
            { prompt: 'Extract this into a separate module', label: 'Extract module' },
            { prompt: 'Add TypeScript types to the refactored code', label: 'Add types' },
            { prompt: 'Write tests for the refactored code', label: 'Test it' },
        );
    } else if (command === 'optimize') {
        followUps.push(
            { prompt: 'Benchmark the before and after', label: 'Benchmark' },
            { prompt: 'Are there cache/memoization opportunities?', label: 'Caching' },
            { prompt: 'Optimize for memory usage too', label: 'Memory' },
        );
    } else if (command === 'new') {
        followUps.push(
            { prompt: 'Add tests for the generated files', label: 'Add tests' },
            { prompt: 'Add documentation', label: 'Add docs' },
            { prompt: 'Set up the build configuration', label: 'Build config' },
        );
    } else if (command === 'search') {
        followUps.push(
            { prompt: 'Search for another pattern', label: 'Search' },
            { prompt: 'Open the found file', label: 'Open file' },
            { prompt: 'Explain the found code', label: 'Explain code' },
        );
    } else if (command === 'commit') {
        followUps.push(
            { prompt: 'Stage all changes', label: 'Stage' },
            { prompt: 'Push the commit', label: 'Push' },
            { prompt: 'Amend the message', label: 'Amend' },
        );
    } else if (command === 'terminal') {
        followUps.push(
            { prompt: 'Run another command', label: 'Run command' },
            { prompt: 'Explain the output', label: 'Explain output' },
            { prompt: 'Create a script for this', label: 'Create script' },
        );
    } else if (command === 'outline') {
        followUps.push(
            { prompt: 'Explain a specific function', label: 'Explain function' },
            { prompt: 'Generate docs', label: 'Generate docs' },
            { prompt: 'Find all usages', label: 'Find usages' },
        );
    } else if (command === 'pr') {
        followUps.push(
            { prompt: 'Add more context to description', label: 'Add context' },
            { prompt: 'Review the diff', label: 'Review diff' },
            { prompt: 'Check for issues', label: 'Check issues' },
        );
    } else {
        const hasCode = responseContent.includes('```');
        const hasError = /error|bug|issue|problem/i.test(responseContent);
        if (hasCode) {
            followUps.push({ prompt: 'Explain this code step by step', label: 'Explain' });
            followUps.push({ prompt: 'Write tests for this', label: 'Write tests' });
        }
        if (hasError) {
            followUps.push({ prompt: 'Fix the issues mentioned above', label: 'Fix it' });
        }
        if (followUps.length === 0) {
            followUps.push(
                { prompt: 'Tell me more', label: 'More details' },
                { prompt: 'Show me an example', label: 'Example' },
            );
        }
    }

    const result = followUps.slice(0, 3);

    // Cache deterministic command-specific follow-ups (skip generic else branch which depends on responseContent)
    const knownCommands = new Set(['explain', 'fix', 'review', 'test', 'refactor', 'optimize', 'new', 'search', 'commit', 'terminal', 'outline', 'pr']);
    if (command && knownCommands.has(command)) {
        _followUpCache.set(command, result);
    }

    return result;
}
