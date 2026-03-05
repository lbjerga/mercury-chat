/**
 * messageManager.ts — Message editing, deletion, bookmarks, reactions
 * Extracted from chatViewProvider.ts
 */

import { MercuryMessage, MercuryTextMessage } from '../mercuryClient';
import { ChatSession } from '../types';
import { ChatViewContext, postMessage, enforceSessionMessageLimit } from '../chatViewContext';
import { learningsManager } from '../learnings';
import { sendActiveSession, sendSessionList, createSession } from '../session/sessionManager';

// ──── Regenerate / Edit / Delete messages ────

export async function regenerateLastResponse(
    ctx: ChatViewContext,
    handleUserMessage: (text: string, mode?: string) => Promise<void>,
): Promise<void> {
    if (!ctx.currentSession) { return; }
    const msgs = ctx.currentSession.messages;
    // Remove from the last assistant message onwards
    while (msgs.length > 0 && msgs[msgs.length - 1].role !== 'user') {
        msgs.pop();
    }
    const lastUser = msgs[msgs.length - 1];
    if (!lastUser || lastUser.role !== 'user') { return; }
    const text = lastUser.content || '';
    msgs.pop();
    ctx.currentSession.updatedAt = Date.now();
    ctx.storage.saveSession(ctx.currentSession);
    sendActiveSession(ctx);
    const modeMatch = text.match(/^\[MODE: (\w+)\]/);
    const mode = modeMatch ? modeMatch[1].toLowerCase() : undefined;
    await handleUserMessage(text, mode);
}

export async function editAndResubmit(
    ctx: ChatViewContext,
    messageIndex: number,
    newText: string,
    mode: string | undefined,
    handleUserMessage: (text: string, mode?: string) => Promise<void>,
): Promise<void> {
    if (!ctx.currentSession) { return; }
    let count = -1;
    let realIndex = -1;
    for (let i = 0; i < ctx.currentSession.messages.length; i++) {
        if (ctx.currentSession.messages[i].role !== 'system') {
            count++;
            if (count === messageIndex) { realIndex = i; break; }
        }
    }
    if (realIndex < 0) { return; }

    // Non-destructive branching: save original as a branch before truncating
    if (realIndex < ctx.currentSession.messages.length - 1) {
        const branchId = 'branch-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const branchSession: ChatSession = {
            id: branchId,
            title: `Branch: ${ctx.currentSession.title}`,
            messages: [...ctx.currentSession.messages],
            createdAt: ctx.currentSession.createdAt,
            updatedAt: Date.now(),
            systemPrompt: ctx.currentSession.systemPrompt,
        };
        ctx.storage.saveSession(branchSession);
        ctx.index.sessions.unshift({
            id: branchId,
            title: branchSession.title,
            createdAt: branchSession.createdAt,
            updatedAt: branchSession.updatedAt,
            pinned: false,
        });
        ctx.storage.saveIndex(ctx.index);
        sendSessionList(ctx);
    }

    ctx.currentSession.messages = ctx.currentSession.messages.slice(0, realIndex);
    ctx.currentSession.updatedAt = Date.now();
    ctx.storage.saveSession(ctx.currentSession);
    sendActiveSession(ctx);
    await handleUserMessage(newText, mode);
}

export function deleteMessage(ctx: ChatViewContext, messageIndex: number): void {
    if (!ctx.currentSession) { return; }
    let count = -1;
    let realIndex = -1;
    for (let i = 0; i < ctx.currentSession.messages.length; i++) {
        if (ctx.currentSession.messages[i].role !== 'system') {
            count++;
            if (count === messageIndex) { realIndex = i; break; }
        }
    }
    if (realIndex < 0) { return; }
    ctx.currentSession.messages.splice(realIndex, 1);
    ctx.currentSession.updatedAt = Date.now();
    ctx.storage.saveSession(ctx.currentSession);
    sendActiveSession(ctx);
}

// ──── Bookmark messages ────

export function bookmarkMessage(ctx: ChatViewContext, messageIndex: number, bookmarked: boolean): void {
    if (!ctx.currentSession) { return; }
    let count = -1;
    for (let i = 0; i < ctx.currentSession.messages.length; i++) {
        if (ctx.currentSession.messages[i].role !== 'system') {
            count++;
            if (count === messageIndex) {
                (ctx.currentSession.messages[i] as MercuryTextMessage)._bookmarked = bookmarked;
                break;
            }
        }
    }
    ctx.currentSession.updatedAt = Date.now();
    ctx.storage.saveSession(ctx.currentSession);
}

// ──── Message reactions ────

export function reactToMessage(ctx: ChatViewContext, messageIndex: number, reaction: string): void {
    if (!ctx.currentSession) { return; }
    let count = -1;
    let targetMsg: MercuryMessage | undefined;
    for (let i = 0; i < ctx.currentSession.messages.length; i++) {
        if (ctx.currentSession.messages[i].role !== 'system') {
            count++;
            if (count === messageIndex) {
                (ctx.currentSession.messages[i] as MercuryTextMessage)._reaction = reaction;
                targetMsg = ctx.currentSession.messages[i];
                break;
            }
        }
    }
    ctx.currentSession.updatedAt = Date.now();
    ctx.storage.saveSession(ctx.currentSession);

    // G4 fix: record positive feedback for learnings
    if (reaction === 'thumbsUp' && targetMsg?.role === 'assistant' && targetMsg.content) {
        const lastUserMsg = [...ctx.currentSession.messages].reverse().find(m => m.role === 'user');
        learningsManager.recordPositiveFeedback(
            lastUserMsg?.content?.slice(0, 200) || 'chat',
            targetMsg.content,
        );
    }
}
