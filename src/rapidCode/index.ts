/**
 * rapidCode/index.ts — Barrel re-export for backward compatibility
 *
 * Existing `import { ... } from './rapidCode'` statements continue to work.
 */

export { executeRapidCode } from './orchestrator';
export { registerRapidCodeTool } from './lmTool';
export { runAgentLoop, trackChangedFiles } from './agentLoop';
export { phasePlan, phaseCode, phaseValidate, phaseTest, phaseAudit } from './phases';

// Re-export types from shared types module
export type { RapidCodeInput, RapidCodeResult, RapidCodePhase, RapidCodeGap, RapidCodeProgress } from '../types';
