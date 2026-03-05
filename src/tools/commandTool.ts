/**
 * tools/commandTool.ts — Shell command execution
 */

import * as cp from 'child_process';

export async function toolRunCommand(
    root: string,
    args: Record<string, unknown>
): Promise<{ content: string; isError: boolean }> {
    const command = args.command as string;

    // Block dangerous commands
    const dangerous = ['rm -rf /', 'format c:', 'del /s /q c:\\'];
    for (const d of dangerous) {
        if (command.toLowerCase().includes(d)) {
            return { content: `Blocked dangerous command: ${command}`, isError: true };
        }
    }

    return new Promise((resolve) => {
        cp.exec(command, {
            cwd: root,
            timeout: 30000,
            maxBuffer: 1024 * 1024,
            shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
        }, (error, stdout, stderr) => {
            let output = '';
            if (stdout) { output += stdout; }
            if (stderr) { output += (output ? '\n' : '') + stderr; }
            if (error && !output) { output = error.message; }

            if (output.length > 10000) {
                output = output.slice(0, 10000) + '\n... (output truncated)';
            }

            resolve({
                content: output || '(no output)',
                isError: error !== null && error.code !== 0,
            });
        });
    });
}
