/**
 * exportManager.ts — Markdown, JSON export, and session statistics
 * Extracted from chatViewProvider.ts
 */

import * as vscode from 'vscode';
import { MercuryToolResultMessage } from '../mercuryClient';
import { ChatSession } from '../types';
import { ChatViewContext, postMessage } from '../chatViewContext';

export function sessionToMarkdown(session: ChatSession): string {
    const lines: string[] = [
        `# ${session.title}`,
        `_Exported ${new Date().toLocaleString()}_\n`,
    ];
    for (const msg of session.messages) {
        if (msg.role === 'system') { continue; }
        if (msg.role === 'user') {
            lines.push(`## User\n\n${msg.content}\n`);
        } else if (msg.role === 'assistant') {
            lines.push(`## Mercury\n\n${msg.content || ''}\n`);
        } else if (msg.role === 'tool') {
            lines.push(`> **Tool result** (${(msg as MercuryToolResultMessage).tool_call_id}):\n> ${(msg.content || '').split('\n').join('\n> ')}\n`);
        }
    }
    return lines.join('\n');
}

export async function exportCurrentChat(ctx: ChatViewContext): Promise<void> {
    if (!ctx.currentSession || ctx.currentSession.messages.length === 0) {
        vscode.window.showWarningMessage('No messages to export.');
        return;
    }
    const md = sessionToMarkdown(ctx.currentSession);
    const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
    await vscode.window.showTextDocument(doc);
}

export async function exportAsJson(ctx: ChatViewContext): Promise<void> {
    if (!ctx.currentSession || ctx.currentSession.messages.length === 0) {
        vscode.window.showWarningMessage('No messages to export.');
        return;
    }
    const json = JSON.stringify({
        title: ctx.currentSession.title,
        createdAt: new Date(ctx.currentSession.createdAt).toISOString(),
        messages: ctx.currentSession.messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role,
            content: m.content,
        })),
    }, null, 2);
    const doc = await vscode.workspace.openTextDocument({ content: json, language: 'json' });
    await vscode.window.showTextDocument(doc);
}

export function sendSessionStats(ctx: ChatViewContext): void {
    if (!ctx.currentSession) { return; }
    const msgs = ctx.currentSession.messages.filter(m => m.role !== 'system');
    const userMsgs = msgs.filter(m => m.role === 'user').length;
    const assistantMsgs = msgs.filter(m => m.role === 'assistant').length;
    const totalChars = msgs.reduce((acc, m) => acc + (m.content?.length || 0), 0);
    postMessage(ctx, {
        type: 'sessionStats',
        stats: {
            totalMessages: msgs.length,
            userMessages: userMsgs,
            assistantMessages: assistantMsgs,
            totalCharacters: totalChars,
            estimatedTokens: Math.ceil(totalChars / 4),
            createdAt: ctx.currentSession.createdAt,
            updatedAt: ctx.currentSession.updatedAt,
        },
    });
}
