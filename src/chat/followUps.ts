/**
 * followUps.ts — Follow-up suggestion generation
 * Extracted from chatViewProvider.ts
 */

import { ActiveFileContext } from '../types';

export function generateFollowUps(mode: string | undefined, activeFileContext: ActiveFileContext | undefined): string[] {
    const followUps: string[] = [];
    if (mode === 'code') {
        followUps.push('Run the tests', 'Add error handling', 'Refactor this', 'Add documentation');
    } else if (mode === 'plan') {
        followUps.push('Now implement this', 'Add more detail', 'What are the trade-offs?', 'Show me the code');
    } else {
        followUps.push('Explain more', 'Show me an example', 'How would I test this?', 'What are alternatives?');
    }
    if (activeFileContext?.diagnostics && activeFileContext.diagnostics.length > 0) {
        followUps.unshift('Fix the errors in my file');
    }
    return followUps.slice(0, 4);
}
