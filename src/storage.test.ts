/**
 * storage.test.ts — Unit tests for ChatStorage
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChatStorage } from './storage';
import { ChatSession, SessionIndex } from './types';

let tmpDir: string;
let storage: ChatStorage;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercury-test-'));
    storage = new ChatStorage(tmpDir);
});

afterEach(() => {
    storage.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeSession(id: string, title = 'Test'): ChatSession {
    return {
        id,
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
    };
}

describe('ChatStorage', () => {
    describe('session CRUD', () => {
        it('saves and loads a session', () => {
            const session = makeSession('s1', 'Hello');
            storage.saveSession(session);
            storage.dispose(); // Force flush

            storage = new ChatStorage(tmpDir);
            const loaded = storage.loadSession('s1');
            expect(loaded).not.toBeNull();
            expect(loaded!.title).toBe('Hello');
            expect(loaded!.id).toBe('s1');
        });

        it('returns null for non-existent session', () => {
            expect(storage.loadSession('nonexistent')).toBeNull();
        });

        it('deletes a session', () => {
            const session = makeSession('s2');
            storage.saveSession(session);
            storage.dispose();

            storage = new ChatStorage(tmpDir);
            storage.deleteSession('s2');
            expect(storage.loadSession('s2')).toBeNull();
        });

        it('handles deleting non-existent session gracefully', () => {
            expect(() => storage.deleteSession('nope')).not.toThrow();
        });
    });

    describe('index', () => {
        it('returns empty index when none exists', () => {
            const index = storage.loadIndex();
            expect(index.sessions).toEqual([]);
            expect(index.activeSessionId).toBeNull();
        });

        it('saves and loads index', () => {
            const index: SessionIndex = {
                sessions: [{ id: 's1', title: 'Chat 1', createdAt: 1, updatedAt: 2 }],
                activeSessionId: 's1',
            };
            storage.saveIndex(index);
            storage.dispose();

            storage = new ChatStorage(tmpDir);
            const loaded = storage.loadIndex();
            expect(loaded.sessions).toHaveLength(1);
            expect(loaded.sessions[0].title).toBe('Chat 1');
            expect(loaded.activeSessionId).toBe('s1');
        });

        it('creates index backup on save', () => {
            const index: SessionIndex = {
                sessions: [{ id: 's1', title: 'First', createdAt: 1, updatedAt: 2 }],
                activeSessionId: 's1',
            };
            storage.saveIndex(index);
            storage.dispose();

            // Save again to trigger backup
            storage = new ChatStorage(tmpDir);
            const index2: SessionIndex = {
                sessions: [{ id: 's2', title: 'Second', createdAt: 3, updatedAt: 4 }],
                activeSessionId: 's2',
            };
            storage.saveIndex(index2);
            storage.dispose();

            // Check backup exists
            const backupPath = path.join(tmpDir, 'sessions', '_index.json.backup');
            expect(fs.existsSync(backupPath)).toBe(true);
        });
    });

    describe('atomic writes', () => {
        it('does not leave .tmp files after flush', () => {
            storage.saveSession(makeSession('s1'));
            storage.dispose();

            const sessionsDir = path.join(tmpDir, 'sessions');
            const files = fs.readdirSync(sessionsDir);
            const tmpFiles = files.filter(f => f.endsWith('.tmp'));
            expect(tmpFiles).toHaveLength(0);
        });
    });
});
