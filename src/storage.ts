/**
 * storage.ts — File-based session persistence
 *
 * ChatStorage reads/writes session data as JSON files inside the
 * extension's globalStorageUri directory.
 */

import * as path from 'path';
import * as fs from 'fs';
import { ChatSession, SessionIndex } from './types';

export class ChatStorage {
    private storageDir: string;
    private pendingWrites = new Map<string, string>();
    private flushTimer?: NodeJS.Timeout;
    private static readonly FLUSH_DELAY_MS = 150;

    constructor(globalStoragePath: string) {
        this.storageDir = path.join(globalStoragePath, 'sessions');
        if (!fs.existsSync(this.storageDir)) {
            fs.mkdirSync(this.storageDir, { recursive: true });
        }
    }

    private get indexPath(): string {
        return path.join(this.storageDir, '_index.json');
    }

    private sessionPath(id: string): string {
        return path.join(this.storageDir, `${id}.json`);
    }

    private scheduleFlush(): void {
        if (this.flushTimer) { return; }
        this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            this.flushPendingWrites();
        }, ChatStorage.FLUSH_DELAY_MS);
    }

    private flushPendingWrites(): void {
        for (const [filePath, content] of this.pendingWrites) {
            const tmpPath = filePath + '.tmp';
            try {
                fs.writeFileSync(tmpPath, content);
                fs.renameSync(tmpPath, filePath);
            } catch (err) {
                console.warn('[Mercury] Atomic write failed for', filePath, err);
                // Fallback: direct write
                try { fs.writeFileSync(filePath, content); } catch { /* best effort */ }
            }
        }
        this.pendingWrites.clear();
    }

    private flushPendingPath(filePath: string): void {
        const pending = this.pendingWrites.get(filePath);
        if (pending === undefined) { return; }
        const tmpPath = filePath + '.tmp';
        try {
            fs.writeFileSync(tmpPath, pending);
            fs.renameSync(tmpPath, filePath);
        } catch {
            fs.writeFileSync(filePath, pending);
        }
        this.pendingWrites.delete(filePath);
    }

    loadIndex(): SessionIndex {
        try {
            this.flushPendingPath(this.indexPath);
            if (fs.existsSync(this.indexPath)) {
                return JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
            }
        } catch (err) {
            console.warn('[Mercury] Corrupted session index, trying backup:', err);
            try {
                const backupPath = this.indexPath + '.backup';
                if (fs.existsSync(backupPath)) {
                    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
                    console.warn('[Mercury] Restored index from backup');
                    return backup;
                }
            } catch { /* backup also corrupted */ }
        }
        return { sessions: [], activeSessionId: null };
    }

    saveIndex(index: SessionIndex): void {
        // Backup current index before overwriting
        try {
            if (fs.existsSync(this.indexPath)) {
                fs.copyFileSync(this.indexPath, this.indexPath + '.backup');
            }
        } catch { /* best effort backup */ }
        this.pendingWrites.set(this.indexPath, JSON.stringify(index, null, 2));
        this.scheduleFlush();
    }

    loadSession(id: string): ChatSession | null {
        try {
            const p = this.sessionPath(id);
            this.flushPendingPath(p);
            if (fs.existsSync(p)) {
                return JSON.parse(fs.readFileSync(p, 'utf-8'));
            }
        } catch (err) { console.warn('[Mercury] Corrupted session file:', id, err); }
        return null;
    }

    saveSession(session: ChatSession): void {
        this.pendingWrites.set(this.sessionPath(session.id), JSON.stringify(session, null, 2));
        this.scheduleFlush();
    }

    deleteSession(id: string): void {
        const p = this.sessionPath(id);
        this.pendingWrites.delete(p);
        try {
            if (fs.existsSync(p)) { fs.unlinkSync(p); }
        } catch (err) {
            console.warn('[Mercury] Failed to delete session file:', id, err);
        }
    }

    dispose(): void {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
        this.flushPendingWrites();
    }
}
