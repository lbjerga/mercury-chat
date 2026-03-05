/**
 * toolConfirmation.ts — Tool confirmation dialog for destructive operations
 * Extracted from chatViewProvider.ts
 */

import * as vscode from 'vscode';
import { ChatViewContext, postMessage } from '../chatViewContext';

export async function confirmTool(ctx: ChatViewContext, name: string, args: string): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('mercuryChat');
    if (!config.get<boolean>('confirmDestructiveTools', true)) { return true; }

    const destructive = ['write_file', 'edit_file', 'run_command'];
    if (!destructive.includes(name)) { return true; }

    return new Promise<boolean>((resolve) => {
        ctx.pendingToolConfirm = { resolve };
        postMessage(ctx, {
            type: 'confirmTool',
            name,
            args,
        });
        // Auto-approve after 30s to avoid deadlock
        setTimeout(() => {
            if (ctx.pendingToolConfirm) {
                ctx.pendingToolConfirm.resolve(true);
                ctx.pendingToolConfirm = undefined;
            }
        }, 30000);
    });
}
