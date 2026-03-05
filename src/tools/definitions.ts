/**
 * tools/definitions.ts — Tool definitions in OpenAI function-calling format
 */

import { ToolDefinition } from '../types';

export const TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the contents of a file in the workspace. Use this to understand existing code before making changes.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Relative path to the file from the workspace root (e.g., "src/index.ts")',
                    },
                    startLine: {
                        type: 'number',
                        description: 'Optional 1-based start line to read from. Omit to read the entire file.',
                    },
                    endLine: {
                        type: 'number',
                        description: 'Optional 1-based end line (inclusive). Omit to read to the end.',
                    },
                },
                required: ['path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Create a new file or completely overwrite an existing file with new content.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Relative path to the file from the workspace root',
                    },
                    content: {
                        type: 'string',
                        description: 'The full content to write to the file',
                    },
                },
                required: ['path', 'content'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'edit_file',
            description: 'Replace a specific string/section in an existing file. Use read_file first to see the current content, then use this to make targeted edits.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Relative path to the file from the workspace root',
                    },
                    oldString: {
                        type: 'string',
                        description: 'The exact text to find and replace (must match exactly, including whitespace)',
                    },
                    newString: {
                        type: 'string',
                        description: 'The replacement text',
                    },
                },
                required: ['path', 'oldString', 'newString'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_files',
            description: 'List files and directories in a workspace directory. Returns names with "/" suffix for directories.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Relative path to the directory from the workspace root. Use "" or "." for root.',
                    },
                    recursive: {
                        type: 'boolean',
                        description: 'If true, list all files recursively (default: false)',
                    },
                },
                required: ['path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'search_files',
            description: 'Search for text or a regex pattern across files in the workspace. Returns matching lines with file paths and line numbers.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'Text or regex pattern to search for',
                    },
                    path: {
                        type: 'string',
                        description: 'Optional relative path to limit search scope (e.g., "src/")',
                    },
                    filePattern: {
                        type: 'string',
                        description: 'Optional glob pattern for files to include (e.g., "*.ts")',
                    },
                },
                required: ['pattern'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'run_command',
            description: 'Run a shell command in the workspace directory. Use for build, test, install, git, etc. Returns stdout+stderr. Commands run with a 30-second timeout.',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'The shell command to execute',
                    },
                },
                required: ['command'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'find_symbols',
            description: 'Find function, class, interface, or variable definitions in the workspace. Searches for common declaration patterns (function, class, const, let, var, interface, type, export, def, etc.).',
            parameters: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'Name or pattern to search for (e.g., "handleSubmit", "UserService")',
                    },
                    path: {
                        type: 'string',
                        description: 'Optional relative path to limit search scope',
                    },
                },
                required: ['pattern'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_diagnostics',
            description: 'Get current VS Code diagnostics (errors, warnings) for a file or the entire workspace. Use this to check for problems after making changes.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Optional relative path to get diagnostics for a specific file. Omit for all workspace diagnostics.',
                    },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'open_file',
            description: 'Open a file in the VS Code editor. Use after creating or editing files to show the result to the user.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Relative path to the file from the workspace root',
                    },
                    line: {
                        type: 'number',
                        description: 'Optional line number to scroll to (1-based)',
                    },
                },
                required: ['path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'rapid_code',
            description: 'Autonomous coding agent — give it a task and it will plan, code, validate, test, and audit the work. Returns a structured result with gaps analysis. Use for complex multi-file tasks. Modes: quick (code only), validate (+ build/diagnostics), test (+ run tests), full (all + audit).',
            parameters: {
                type: 'object',
                properties: {
                    task: {
                        type: 'string',
                        description: 'The coding task to complete (e.g., "Add authentication middleware to the Express app")',
                    },
                    mode: {
                        type: 'string',
                        enum: ['quick', 'validate', 'test', 'full'],
                        description: 'Execution mode: quick (code only), validate (+ build check), test (+ tests), full (all + audit). Default: full',
                    },
                    files: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional list of relevant file paths to read as context before starting',
                    },
                    context: {
                        type: 'string',
                        description: 'Optional additional context, requirements, or constraints',
                    },
                },
                required: ['task'],
            },
        },
    },
];
