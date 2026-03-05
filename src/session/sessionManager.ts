/**
 * sessionManager.ts — Session CRUD, state communication, search, pin & tag
 * Extracted from chatViewProvider.ts to keep the provider slim.
 */

import * as vscode from 'vscode';
import { MercuryToolCallMessage, MercuryToolResultMessage } from '../mercuryClient';
import { ChatSession } from '../types';
import { ChatViewContext, postMessage } from '../chatViewContext';
import { generateId } from '../utils';

// ──── Session CRUD ────

export function createSession(ctx: ChatViewContext): ChatSession {
    const session: ChatSession = {
        id: generateId(),
        title: `Chat ${ctx.index.sessions.length + 1}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
    };
    ctx.storage.saveSession(session);
    ctx.index.sessions.unshift({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
    });
    ctx.index.activeSessionId = session.id;
    ctx.storage.saveIndex(ctx.index);
    return session;
}

export function switchToSession(ctx: ChatViewContext, id: string): void {
    if (ctx.currentSession) {
        ctx.storage.saveSession(ctx.currentSession);
    }
    const session = ctx.storage.loadSession(id);
    if (!session) { return; }
    ctx.currentSession = session;
    ctx.index.activeSessionId = id;
    ctx.storage.saveIndex(ctx.index);
    sendActiveSession(ctx);
    sendSessionList(ctx);
    const draft = ctx.inputDrafts.get(id) || '';
    postMessage(ctx, { type: 'restoreDraft', text: draft });
}

export function renameSession(ctx: ChatViewContext, id: string, title: string): void {
    const entry = ctx.index.sessions.find(s => s.id === id);
    if (entry) { entry.title = title; ctx.storage.saveIndex(ctx.index); }

    const session = id === ctx.currentSession?.id
        ? ctx.currentSession
        : ctx.storage.loadSession(id);
    if (session) {
        session.title = title;
        ctx.storage.saveSession(session);
        if (id === ctx.currentSession?.id) { ctx.currentSession = session; }
    }
    sendSessionList(ctx);
    if (id === ctx.currentSession?.id) {
        postMessage(ctx, { type: 'updateTitle', title });
    }
}

export function deleteSession(ctx: ChatViewContext, id: string): void {
    ctx.index.sessions = ctx.index.sessions.filter(s => s.id !== id);
    ctx.storage.deleteSession(id);

    if (ctx.currentSession?.id === id) {
        ctx.currentSession = null;
        if (ctx.index.sessions.length > 0) {
            switchToSession(ctx, ctx.index.sessions[0].id);
        } else {
            const newSes = createSession(ctx);
            switchToSession(ctx, newSes.id);
        }
    }
    ctx.storage.saveIndex(ctx.index);
    sendSessionList(ctx);
}

// ──── Send state to webview ────

export function sendSessionList(ctx: ChatViewContext): void {
    const sessionsWithIntent = ctx.index.sessions.map(s => {
        let intent = '';
        const session = s.id === ctx.currentSession?.id
            ? ctx.currentSession
            : ctx.storage.loadSession(s.id);
        if (session) {
            const firstUserMsg = session.messages.find(m => m.role === 'user');
            if (firstUserMsg && firstUserMsg.content) {
                const raw = (firstUserMsg.content as string).replace(/^\[MODE: \w+\]\s*/, '');
                intent = raw.length > 60 ? raw.slice(0, 57) + '...' : raw;
            }
        }
        return { ...s, intent };
    });
    postMessage(ctx, {
        type: 'sessionList',
        sessions: sessionsWithIntent,
        activeId: ctx.index.activeSessionId,
    });
}

export function sendActiveSession(ctx: ChatViewContext): void {
    if (!ctx.currentSession) { return; }
    const messages = ctx.currentSession.messages
        .filter(m => m.role !== 'system')
        .map(m => {
            if ('tool_calls' in m) {
                return { role: m.role, content: m.content, tool_calls: (m as MercuryToolCallMessage).tool_calls };
            }
            return m;
        });
    postMessage(ctx, {
        type: 'loadSession',
        session: {
            id: ctx.currentSession.id,
            title: ctx.currentSession.title,
            messages,
            systemPrompt: ctx.currentSession.systemPrompt || '',
        },
    });
}

// ──── Session pinning & search ────

export function pinSession(ctx: ChatViewContext, id: string, pinned: boolean): void {
    const entry = ctx.index.sessions.find(s => s.id === id);
    if (entry) {
        entry.pinned = pinned;
        ctx.storage.saveIndex(ctx.index);
        sendSessionList(ctx);
    }
}

export function searchSessions(ctx: ChatViewContext, query: string): void {
    if (!query.trim()) {
        sendSessionList(ctx);
        return;
    }
    const q = query.toLowerCase();
    const filtered = ctx.index.sessions.filter(s => {
        if (s.title.toLowerCase().includes(q)) { return true; }
        const session = s.id === ctx.currentSession?.id
            ? ctx.currentSession
            : ctx.storage.loadSession(s.id);
        if (session) {
            return session.messages.some(m => m.content && m.content.toLowerCase().includes(q));
        }
        return false;
    });
    const withIntent = filtered.map(s => {
        let intent = '';
        const session = s.id === ctx.currentSession?.id
            ? ctx.currentSession
            : ctx.storage.loadSession(s.id);
        if (session) {
            const firstUserMsg = session.messages.find(m => m.role === 'user');
            if (firstUserMsg && firstUserMsg.content) {
                const raw = (firstUserMsg.content as string).replace(/^\[MODE: \w+\]\s*/, '');
                intent = raw.length > 60 ? raw.slice(0, 57) + '...' : raw;
            }
        }
        return { ...s, intent };
    });
    postMessage(ctx, {
        type: 'sessionList',
        sessions: withIntent,
        activeId: ctx.index.activeSessionId,
    });
}

// ──── Session color tags ────

export function tagSession(ctx: ChatViewContext, id: string, tag: string): void {
    const entry = ctx.index.sessions.find(s => s.id === id);
    if (entry) {
        entry.tag = tag;
        ctx.storage.saveIndex(ctx.index);
        sendSessionList(ctx);
    }
}
