/**
 * rapidCode/phases.ts — Individual Rapid Code execution phases
 */

import { MercuryClient, MercuryMessage } from '../mercuryClient';
import { executeTool } from '../tools';
import { RapidCodeGap, RapidCodeProgress } from '../types';
import { generateId, getWorkspaceRoot } from '../utils';
import { RC_SYSTEM_PREAMBLE } from '../promptCache';
import { runAgentLoop } from './agentLoop';

function compactText(text: string, maxChars: number, headChars = 70): string {
    if (!text) { return ''; }
    if (text.length <= maxChars) { return text; }
    const head = Math.floor(maxChars * (headChars / 100));
    const tail = Math.max(0, maxChars - head);
    return `${text.slice(0, head)}\n...(compressed ${text.length - maxChars} chars)...\n${text.slice(-tail)}`;
}

/** Phase 1: Plan — ask Mercury to analyze and produce a plan */
export async function phasePlan(
    client: MercuryClient,
    task: string,
    filesContext: string,
    additionalContext: string,
    onProgress: RapidCodeProgress,
    signal?: AbortSignal
): Promise<string> {
    onProgress('plan', 'Analyzing task and creating plan...');

    const compactTask = compactText(task, 1800);
    const compactAdditionalContext = compactText(additionalContext, 1200);

    // Compact file context for plan phase — just enough for architecture decisions
    const planFilesCtx = filesContext.length > 3000
        ? filesContext.slice(0, 3000) + '\n...(truncated — agent will read full files during coding phase)'
        : filesContext;

    const messages: MercuryMessage[] = [
        {
            role: 'system',
            content: `${RC_SYSTEM_PREAMBLE}

You are acting as an expert software architect. Analyze the user's coding task and produce a clear, concise execution plan.
List the specific files to create/modify, the approach, and any dependencies.
Be specific — mention exact file paths, function names, and the order of operations.
Keep the plan under 500 words. Do NOT write any code yet — just the plan.`
        },
        {
            role: 'user',
            content: `Task: ${compactTask}${planFilesCtx ? `\n\nRelevant files:\n${planFilesCtx}` : ''}${compactAdditionalContext ? `\n\nAdditional context:\n${compactAdditionalContext}` : ''}`
        }
    ];

    const result = await client.chat(messages);
    onProgress('plan', 'Plan complete');
    return result.content;
}

/** Phase 2: Code — run the autonomous agent loop */
export async function phaseCode(
    client: MercuryClient,
    task: string,
    plan: string,
    filesContext: string,
    additionalContext: string,
    gapContext: string,
    onProgress: RapidCodeProgress,
    signal?: AbortSignal,
    sharedToolCache?: Map<string, string>
): Promise<{ content: string; toolCalls: Array<{ name: string; args: string }>; totalCalls: number }> {
    onProgress('coding', 'Starting autonomous coding...');

    const isSelfHealIteration = Boolean(gapContext && gapContext.trim().length > 0);
    const compactTask = compactText(task, isSelfHealIteration ? 900 : 1800);
    const compactPlan = compactText(plan, isSelfHealIteration ? 900 : 2200);
    const compactAdditionalContext = compactText(additionalContext, isSelfHealIteration ? 700 : 1200);
    const compactGapContext = compactText(gapContext, 2400);

    const systemPrompt = `${RC_SYSTEM_PREAMBLE}

Expert coding agent. Execute the plan using workspace tools. Read files before editing. Use edit_file for changes, write_file for new files. Run get_diagnostics after edits. Fix errors immediately. Complete the ENTIRE task.

PLAN:
${compactPlan}
${compactGapContext ? `\nFIX THESE GAPS:\n${compactGapContext}` : ''}

TOKEN DISCIPLINE:
- Avoid re-reading already-understood large files unless required.
- Keep tool outputs concise in reasoning.
- In self-heal iterations, focus only on unresolved gaps.`;

    // Don't re-embed large filesContext — the agent can read files with tools
    const compactFilesCtx = filesContext.length > 2000
        ? filesContext.slice(0, 2000) + '\n...(use read_file tool for full content)'
        : filesContext;

    const messages: MercuryMessage[] = [
        { role: 'system', content: systemPrompt },
        {
            role: 'user',
            content: `${isSelfHealIteration ? 'Self-heal mode: fix only remaining blockers from the listed gaps.' : 'Execute this task:'}\n\n${compactTask}${compactFilesCtx ? `\n\nRelevant files (summary):\n${compactFilesCtx}` : ''}${compactAdditionalContext ? `\n\nAdditional context:\n${compactAdditionalContext}` : ''}`
        }
    ];

    return runAgentLoop(client, messages, onProgress, signal, sharedToolCache);
}

/** Phase 3: Validate — run build + diagnostics */
export async function phaseValidate(
    onProgress: RapidCodeProgress,
    buildCommand: string
): Promise<{ errors: number; warnings: number; details: string }> {
    onProgress('validate', 'Running validation...');
    const workspaceRoot = getWorkspaceRoot();
    const parts: string[] = [];
    let errors = 0;
    let warnings = 0;

    if (buildCommand) {
        onProgress('validate', `Running build: ${buildCommand}`);
        const buildResult = await executeTool(
            { id: generateId(), function: { name: 'run_command', arguments: JSON.stringify({ command: buildCommand }) } },
            workspaceRoot
        );
        parts.push(`**Build (${buildCommand}):**\n${buildResult.content}`);
        if (buildResult.isError) {
            const errorLines = buildResult.content.split('\n').filter(l => /error/i.test(l));
            errors += errorLines.length || 1;
        }
    }

    onProgress('validate', 'Checking diagnostics...');
    const diagResult = await executeTool(
        { id: generateId(), function: { name: 'get_diagnostics', arguments: '{}' } },
        workspaceRoot
    );
    parts.push(`**Diagnostics:**\n${diagResult.content}`);

    const errorMatches = diagResult.content.match(/\[ERROR\]/gi);
    const warnMatches = diagResult.content.match(/\[WARN\]/gi);
    errors += errorMatches ? errorMatches.length : 0;
    warnings += warnMatches ? warnMatches.length : 0;

    onProgress('validate', `Validation: ${errors} errors, ${warnings} warnings`);

    return { errors, warnings, details: parts.join('\n\n') };
}

/** Phase 4: Test — run test suite */
export async function phaseTest(
    onProgress: RapidCodeProgress,
    testCommand: string
): Promise<{ passed: number; failed: number; output: string }> {
    onProgress('test', `Running tests: ${testCommand}`);
    const workspaceRoot = getWorkspaceRoot();

    const result = await executeTool(
        { id: generateId(), function: { name: 'run_command', arguments: JSON.stringify({ command: testCommand }) } },
        workspaceRoot
    );

    let passed = 0;
    let failed = 0;
    const output = result.content;

    const jestMatch = output.match(/(\d+)\s+passed/i);
    const jestFail = output.match(/(\d+)\s+failed/i);
    if (jestMatch) { passed = parseInt(jestMatch[1]); }
    if (jestFail) { failed = parseInt(jestFail[1]); }

    if (!jestMatch) {
        const pytestMatch = output.match(/(\d+)\s+passed/);
        const pytestFail = output.match(/(\d+)\s+failed/);
        if (pytestMatch) { passed = parseInt(pytestMatch[1]); }
        if (pytestFail) { failed = parseInt(pytestFail[1]); }
    }

    if (passed === 0 && failed === 0) {
        if (result.isError) { failed = 1; } else { passed = 1; }
    }

    onProgress('test', `Tests: ${passed} passed, ${failed} failed`);
    return { passed, failed, output };
}

/** Phase 5: Audit — Mercury reviews the work */
export async function phaseAudit(
    client: MercuryClient,
    task: string,
    plan: string,
    filesChanged: string[],
    validationDetails: string,
    testOutput: string,
    mode: string,
    onProgress: RapidCodeProgress,
    signal?: AbortSignal
): Promise<{ audit: string; gaps: RapidCodeGap[] }> {
    onProgress('audit', 'Auditing changes vs requirements...');

    const compactTask = compactText(task, 1600);
    const compactPlan = compactText(plan, 2200);
    const compactValidationDetails = compactText(validationDetails, 3500);
    const compactTestOutput = compactText(testOutput, 2500);

    const workspaceRoot = getWorkspaceRoot();
    const fileContents: string[] = [];
    for (const f of filesChanged.slice(0, 10)) {
        try {
            const result = await executeTool(
                { id: generateId(), function: { name: 'read_file', arguments: JSON.stringify({ path: f }) } },
                workspaceRoot
            );
            if (!result.isError) {
                fileContents.push(`=== ${f} ===\n${result.content}`);
            }
        } catch { /* skip */ }
    }

    // Truncate file contents for audit to save tokens
    const maxAuditChars = 12000;
    let auditFileContent = '';
    let auditChars = 0;
    for (const fc of fileContents) {
        if (auditChars + fc.length > maxAuditChars) {
            const remaining = maxAuditChars - auditChars;
            if (remaining > 200) {
                auditFileContent += fc.slice(0, remaining) + '\n...(truncated for token budget)\n';
            }
            break;
        }
        auditFileContent += fc + '\n\n';
        auditChars += fc.length;
    }

    const auditPrompt = `You are a senior code reviewer performing a thorough audit.

ORIGINAL TASK:
${compactTask}

EXECUTION PLAN:
${compactPlan}

FILES CHANGED (${filesChanged.length}): ${filesChanged.join(', ')}

${auditFileContent ? `FILE CONTENTS:\n${auditFileContent}` : ''}

${compactValidationDetails ? `VALIDATION RESULTS:\n${compactValidationDetails}` : ''}

${compactTestOutput ? `TEST RESULTS:\n${compactTestOutput}` : ''}

AUDIT INSTRUCTIONS:
1. Check if the task was completed fully
2. Identify any gaps — missing requirements, incomplete implementation, errors
3. Check code quality — proper error handling, types, naming, patterns
4. Verify correctness

Respond in this EXACT format:
SUMMARY: (1-2 sentence overall assessment)

GAPS:
- [type:error|warning|missing|quality] [file:path] [line:N] message
- [type:...] message
(if no gaps, write: NONE)

SCORE: X/10`;

    const messages: MercuryMessage[] = [
        { role: 'system', content: `${RC_SYSTEM_PREAMBLE}\n\nYou are a senior code reviewer performing a thorough audit.` },
        { role: 'user', content: auditPrompt }
    ];

    const result = await client.chat(messages);
    const auditText = result.content;

    const gaps: RapidCodeGap[] = [];
    const gapLines = auditText.split('\n').filter(l => l.trim().startsWith('- [type:'));
    for (const line of gapLines) {
        const typeMatch = line.match(/\[type:(error|warning|missing|quality)\]/);
        const fileMatch = line.match(/\[file:([^\]]+)\]/);
        const lineMatch = line.match(/\[line:(\d+)\]/);
        const messageMatch = line.match(/\]\s*(.+)$/);

        if (typeMatch) {
            gaps.push({
                type: typeMatch[1] as RapidCodeGap['type'],
                file: fileMatch?.[1],
                line: lineMatch ? parseInt(lineMatch[1]) : undefined,
                message: messageMatch?.[1]?.trim() || line,
            });
        }
    }

    onProgress('audit', `Audit complete: ${gaps.length} gaps found`);
    return { audit: auditText, gaps };
}
