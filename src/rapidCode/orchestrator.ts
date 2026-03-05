/**
 * rapidCode/orchestrator.ts — Main Rapid Code execution orchestrator
 */

import * as vscode from 'vscode';
import { MercuryClient } from '../mercuryClient';
import { executeTool } from '../tools';
import type { ProviderRouter } from '../providers';
import {
    RapidCodeInput, RapidCodePhase, RapidCodeGap, RapidCodeResult, RapidCodeProgress
} from '../types';
import { generateId, getWorkspaceRoot } from '../utils';
import { trackChangedFiles } from './agentLoop';
import { phasePlan, phaseCode, phaseValidate, phaseTest, phaseAudit } from './phases';
import { logRapidPhase } from '../outputChannel';
import { gitStashCheckpoint } from '../gitContext';
import { learningsManager } from '../learnings';

const MAX_SELF_HEAL = 3;

export async function executeRapidCode(
    input: RapidCodeInput,
    client: MercuryClient,
    onProgress: RapidCodeProgress = () => {},
    signal?: AbortSignal,
    router?: ProviderRouter
): Promise<RapidCodeResult> {
    const startTime = Date.now();
    const mode = input.mode || 'full';
    const config = vscode.workspace.getConfiguration('mercuryChat');
    const buildCommand = config.get<string>('rapidCodeBuildCommand', 'npm run build');
    const testCommand = config.get<string>('rapidCodeTestCommand', 'npm test');

    const phases: RapidCodePhase[] = [
        { name: 'plan', status: 'pending' },
        { name: 'code', status: 'pending' },
    ];
    if (mode !== 'quick') { phases.push({ name: 'validate', status: 'pending' }); }
    if (mode === 'test' || mode === 'full') { phases.push({ name: 'test', status: 'pending' }); }
    phases.push({ name: 'audit', status: 'pending' });

    let plan = '';
    let filesChanged: string[] = [];
    let validation: RapidCodeResult['validation'];
    let testResult: RapidCodeResult['testResult'];
    let audit = '';
    let gaps: RapidCodeGap[] = [];
    let totalToolCalls = 0;
    let iterations = 0;
    let stashCreated = false;

    // Read context from specified files (token-aware: truncate large files)
    const MAX_CONTEXT_CHARS = 8000; // ~2000 tokens max for file context
    let filesContext = '';
    if (input.files && input.files.length > 0) {
        const workspaceRoot = getWorkspaceRoot();
        for (const f of input.files.slice(0, 5)) {
            if (filesContext.length >= MAX_CONTEXT_CHARS) {
                filesContext += `\nFile: ${f} (skipped — context budget reached)\n`;
                continue;
            }
            try {
                const result = await executeTool(
                    { id: generateId(), function: { name: 'read_file', arguments: JSON.stringify({ path: f }) } },
                    workspaceRoot
                );
                if (!result.isError) {
                    const content = result.content;
                    const lines = content.split('\n');
                    if (content.length > 4000 || lines.length > 150) {
                        // Large file: include first 80 lines + note
                        const truncated = lines.slice(0, 80).join('\n');
                        filesContext += `\nFile: ${f} (${lines.length} lines, showing first 80 — use read_file tool for full content)\n${truncated}\n...truncated...\n`;
                    } else {
                        filesContext += `\n${content}\n`;
                    }
                }
            } catch { /* skip */ }
        }
    }

    try {
        // START logging and git stash checkpoint
        logRapidPhase('START', `Task: ${input.task}`);
        try {
            const stashResult = await gitStashCheckpoint();
            stashCreated = stashResult;
            if (stashCreated) logRapidPhase('CHECKPOINT', 'Git stash checkpoint created');
        } catch { /* no git or nothing to stash */ }

        // Phase 1: Plan
        logRapidPhase('PLAN', 'Starting plan phase');
        const planPhase = phases.find(p => p.name === 'plan')!;
        planPhase.status = 'running';
        const planStart = Date.now();
        plan = await phasePlan(client, input.task, filesContext, input.context || '', onProgress, signal);
        planPhase.duration = Date.now() - planStart;
        planPhase.status = 'done';
        logRapidPhase('DONE', `plan completed in ${planPhase.duration} ms`);
        planPhase.summary = plan.split('\n')[0];

        // Self-heal loop
        let gapContext = '';
        const sharedToolCache = new Map<string, string>(); // #12 Persist tool results across self-heal iterations
        for (iterations = 1; iterations <= MAX_SELF_HEAL + 1; iterations++) {
            if (signal?.aborted) { throw new Error('Cancelled'); }

            // Phase 2: Code
            logRapidPhase('CODE', 'Starting code phase');
            const codePhase = phases.find(p => p.name === 'code')!;
            codePhase.status = 'running';
            const codeStart = Date.now();
            const codeResult = await phaseCode(
                client, input.task, plan, filesContext, input.context || '', gapContext, onProgress, signal, sharedToolCache
            );
            codePhase.duration = Date.now() - codeStart;
            codePhase.status = 'done';
            logRapidPhase('DONE', `code completed in ${codePhase.duration} ms`);
            totalToolCalls += codeResult.totalCalls;
            filesChanged = trackChangedFiles(codeResult.toolCalls);
            codePhase.summary = `${codeResult.totalCalls} tool calls, ${filesChanged.length} files changed`;

            // Phase 3: Validate + Phase 4: Test — run in parallel when both are needed (#16)
            const runValidate = mode !== 'quick';
            const runTest = mode === 'test' || mode === 'full';

            if (runValidate && runTest) {
                // Parallel execution
                logRapidPhase('VALIDATE+TEST', 'Starting validate and test phases in parallel');
                const valPhase = phases.find(p => p.name === 'validate')!;
                const testPhase = phases.find(p => p.name === 'test')!;
                valPhase.status = 'running';
                testPhase.status = 'running';
                const parallelStart = Date.now();

                const [valResult, tstResult] = await Promise.all([
                    phaseValidate(onProgress, buildCommand),
                    phaseTest(onProgress, testCommand),
                ]);

                validation = valResult;
                valPhase.duration = Date.now() - parallelStart;
                valPhase.status = validation.errors > 0 ? 'error' : 'done';
                valPhase.summary = `${validation.errors} errors, ${validation.warnings} warnings`;
                logRapidPhase('DONE', `validate completed in ${valPhase.duration} ms`);

                testResult = tstResult;
                testPhase.duration = Date.now() - parallelStart;
                testPhase.status = testResult.failed > 0 ? 'error' : 'done';
                testPhase.summary = `${testResult.passed} passed, ${testResult.failed} failed`;
                logRapidPhase('DONE', `test completed in ${testPhase.duration} ms`);
            } else {
                // Sequential execution (only one needed)
                if (runValidate) {
                    logRapidPhase('VALIDATE', 'Starting validate phase');
                    const valPhase = phases.find(p => p.name === 'validate')!;
                    valPhase.status = 'running';
                    const valStart = Date.now();
                    validation = await phaseValidate(onProgress, buildCommand);
                    valPhase.duration = Date.now() - valStart;
                    valPhase.status = validation.errors > 0 ? 'error' : 'done';
                    logRapidPhase('DONE', `validate completed in ${valPhase.duration} ms`);
                    valPhase.summary = `${validation.errors} errors, ${validation.warnings} warnings`;
                }

                if (runTest) {
                    logRapidPhase('TEST', 'Starting test phase');
                    const testPhase = phases.find(p => p.name === 'test')!;
                    testPhase.status = 'running';
                    const testStart = Date.now();
                    testResult = await phaseTest(onProgress, testCommand);
                    testPhase.duration = Date.now() - testStart;
                    testPhase.status = testResult.failed > 0 ? 'error' : 'done';
                    logRapidPhase('DONE', `test completed in ${testPhase.duration} ms`);
                    testPhase.summary = `${testResult.passed} passed, ${testResult.failed} failed`;
                }
            }

            // Phase 5: Audit
            logRapidPhase('AUDIT', 'Starting audit phase');
            const auditPhase = phases.find(p => p.name === 'audit')!;
            auditPhase.status = 'running';
            const auditStart = Date.now();
            const auditResult = await phaseAudit(
                client, input.task, plan, filesChanged,
                validation?.details || '', testResult?.output || '',
                mode, onProgress, signal
            );
            audit = auditResult.audit;
            gaps = auditResult.gaps;
            auditPhase.duration = Date.now() - auditStart;
            auditPhase.status = gaps.length > 0 ? 'error' : 'done';
            logRapidPhase('DONE', `audit completed in ${auditPhase.duration} ms`);
            auditPhase.summary = gaps.length > 0 ? `${gaps.length} gaps found` : 'All clear';

            // Check if self-heal needed
            const hasBlockingGaps = gaps.some(g => g.type === 'error' || g.type === 'missing');
            const hasValidationErrors = validation && validation.errors > 0;
            const hasTestFailures = testResult && testResult.failed > 0;

            if ((hasBlockingGaps || hasValidationErrors || hasTestFailures) && iterations <= MAX_SELF_HEAL) {
                onProgress('self-heal', `Iteration ${iterations}: ${gaps.length} gaps, ${validation?.errors || 0} errors — self-healing...`);

                const gapLines: string[] = [];
                for (const g of gaps) {
                    gapLines.push(`[${g.type}]${g.file ? ` ${g.file}` : ''}${g.line ? `:${g.line}` : ''}: ${g.message}`);
                }
                if (hasValidationErrors) {
                    gapLines.push(`\nBuild/diagnostic errors:\n${validation!.details.slice(0, 2200)}`);
                }
                if (hasTestFailures) {
                    gapLines.push(`\nTest failures:\n${testResult!.output.slice(0, 1500)}`);
                }
                gapContext = gapLines.join('\n');

                phases.filter(p => p.name !== 'plan').forEach(p => { p.status = 'pending'; p.summary = undefined; p.duration = undefined; });
                continue;
            }

            break;
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        onProgress('error', msg);
        return {
            success: false, plan, filesChanged, phases, validation, testResult,
            audit, gaps, iterations, totalToolCalls,
            totalTime: Date.now() - startTime,
            summary: `Rapid Code failed: ${msg}`,
        };
    } finally {
        if (stashCreated) {
            logRapidPhase('CHECKPOINT', 'Git stash available for rollback if needed');
        }
    }

    const totalTime = Date.now() - startTime;
    const success = gaps.filter(g => g.type === 'error' || g.type === 'missing').length === 0
        && (!validation || validation.errors === 0)
        && (!testResult || testResult.failed === 0);

    // #25 Self-evaluation scoring
    let score = 0;
    if (success) { score += 30; }
    if (!validation || validation.errors === 0) { score += 20; }
    if (!testResult || testResult.failed === 0) { score += 20; }
    if (gaps.length === 0) { score += 15; }
    if (iterations <= 2) { score += 15; }

    // #29 Post-run optimization tip
    let optimizationTip = 'All good!';
    if (totalToolCalls > 15) { optimizationTip = 'Consider caching frequently used files to reduce tool calls.'; }
    else if (iterations > 2) { optimizationTip = 'Improve planning phase to reduce self-heal iterations.'; }

    // #28 Record learnings from this run
    try {
        learningsManager.recordLearning({
            task: input.task,
            outcome: success ? 'success' : 'partial',
            toolsUsed: [...new Set(filesChanged)],
            tokensUsed: totalToolCalls,
            costUsd: 0,
            durationMs: totalTime,
            errorPatterns: gaps.map(g => g.message),
            timestamp: Date.now(),
        });
    } catch { /* learnings write failure is non-fatal */ }

    const summary = success
        ? `✅ Task completed successfully in ${iterations} iteration(s). ${filesChanged.length} files changed, ${totalToolCalls} tool calls, ${(totalTime / 1000).toFixed(1)}s. Score: ${score}/100.\n\n💡 ${optimizationTip}`
        : `⚠️ Task completed with ${gaps.length} remaining gaps after ${iterations} iteration(s). ${filesChanged.length} files changed, ${totalToolCalls} tool calls, ${(totalTime / 1000).toFixed(1)}s. Score: ${score}/100.\n\n💡 ${optimizationTip}`;

    onProgress('done', summary);

    return {
        success, plan, filesChanged, phases, validation, testResult,
        audit, gaps, iterations, totalToolCalls, totalTime, summary, score, optimizationTip,
    };
}
