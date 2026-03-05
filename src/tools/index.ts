/**
 * tools/index.ts — Barrel re-export for backward compatibility
 *
 * All existing `import { ... } from './tools'` statements continue to work.
 */

// Types (from shared types module)
export { ToolDefinition, ToolCall, ToolResult } from '../types';

// Definitions
export { TOOL_DEFINITIONS } from './definitions';

// Executor
export { executeTool, READ_ONLY_TOOLS } from './executor';

// Tool result cache
export { toolResultCache } from './toolCache';

// Helpers (re-export for any direct consumers)
export { resolvePath } from './helpers';
