/**
 * types.ts — Shared type definitions for Mercury Chat
 *
 * Centralizes interfaces used across multiple modules to prevent
 * circular dependencies and duplication.
 */

import { MercuryMessage } from './mercuryClient';

// ──────────────────────────────────────────────
// Chat session types (from chatViewProvider)
// ──────────────────────────────────────────────

export interface ChatSession {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: MercuryMessage[];
    systemPrompt?: string;
}

export interface SessionIndex {
    sessions: Array<{
        id: string;
        title: string;
        createdAt: number;
        updatedAt: number;
        messageCount?: number;
        pinned?: boolean;
        tag?: string;
    }>;
    activeSessionId: string | null;
}

export interface ActiveFileContext {
    path: string;
    language: string;
    lineCount: number;
    selection?: {
        text: string;
        startLine: number;
        endLine: number;
    };
    diagnostics?: Array<{
        line: number;
        severity: string;
        message: string;
    }>;
}

// ──────────────────────────────────────────────
// Tool types (from tools.ts)
// ──────────────────────────────────────────────

export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

export interface ToolCall {
    id: string;
    function: {
        name: string;
        arguments: string;
    };
}

export interface ToolResult {
    toolCallId: string;
    name: string;
    content: string;
    isError: boolean;
}

// ──────────────────────────────────────────────
// Rapid Code types (from rapidCode.ts)
// ──────────────────────────────────────────────

export interface RapidCodeInput {
    task: string;
    mode?: 'quick' | 'validate' | 'test' | 'full';
    files?: string[];
    context?: string;
}

export interface RapidCodePhase {
    name: string;
    status: 'pending' | 'running' | 'done' | 'error';
    summary?: string;
    duration?: number;
}

export interface RapidCodeGap {
    type: 'error' | 'warning' | 'missing' | 'quality';
    file?: string;
    line?: number;
    message: string;
}

export interface RapidCodeResult {
    success: boolean;
    plan: string;
    filesChanged: string[];
    phases: RapidCodePhase[];
    validation?: { errors: number; warnings: number; details: string };
    testResult?: { passed: number; failed: number; output: string };
    audit: string;
    gaps: RapidCodeGap[];
    iterations: number;
    totalToolCalls: number;
    totalTime: number;
    summary: string;
    score?: number;
    optimizationTip?: string;
}

export type RapidCodeProgress = (phase: string, message: string) => void;

// ──────────────────────────────────────────────
// Session-level tool approval tracking (#2)
// ──────────────────────────────────────────────

export interface SessionToolApproval {
    /** Tools that have been auto-approved for this session */
    alwaysAllow: Set<string>;
}

// ──────────────────────────────────────────────
// Tool call tracking for summaries (#25)
// ──────────────────────────────────────────────

export interface ToolCallSummaryEntry {
    name: string;
    args: string;
    result: string;
    isError: boolean;
    duration: number;
}
