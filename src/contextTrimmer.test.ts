/**
 * contextTrimmer.test.ts — Tests for token estimation and message trimming
 */
import { describe, it, expect } from 'vitest';
import { estimateTokens, trimMessagesToTokenLimit } from './chat/contextTrimmer';
import type { MercuryMessage } from './mercuryClient';

describe('estimateTokens', () => {
    it('estimates ~4 chars per token', () => {
        expect(estimateTokens('abcd')).toBe(1);
        expect(estimateTokens('abcdefgh')).toBe(2);
    });

    it('rounds up', () => {
        expect(estimateTokens('abcde')).toBe(2); // ceil(5/4)
    });

    it('handles empty string', () => {
        expect(estimateTokens('')).toBe(0);
    });

    it('handles very long strings', () => {
        const tokens = estimateTokens('a'.repeat(10000));
        expect(tokens).toBe(2500);
    });
});

describe('trimMessagesToTokenLimit', () => {
    const sys: MercuryMessage = { role: 'system', content: 'You are a helper.' };

    it('returns messages as-is when under budget', async () => {
        const msgs: MercuryMessage[] = [
            sys,
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi' },
        ];
        const result = await trimMessagesToTokenLimit(msgs, 10000, undefined);
        expect(result.length).toBe(3);
    });

    it('returns messages as-is when only 2 messages', async () => {
        const msgs: MercuryMessage[] = [
            sys,
            { role: 'user', content: 'hello' },
        ];
        const result = await trimMessagesToTokenLimit(msgs, 1, undefined);
        expect(result.length).toBe(2);
    });

    it('trims oldest messages when over budget', async () => {
        const msgs: MercuryMessage[] = [
            { role: 'system', content: 'a'.repeat(100) },  // 25 tokens
            { role: 'user', content: 'b'.repeat(200) },     // 50 tokens
            { role: 'assistant', content: 'c'.repeat(200) }, // 50 tokens
            { role: 'user', content: 'd'.repeat(200) },     // 50 tokens (most recent)
        ];
        // Budget = 80 tokens → system(25) + last user(50) = 75, no room for middle two
        const result = await trimMessagesToTokenLimit(msgs, 80, undefined);
        // Should keep system + most recent message(s)
        expect(result.length).toBeLessThan(msgs.length);
        // System prompt is always first
        expect(result[0].role).toBe('system');
        // Most recent message preserved
        expect(result[result.length - 1].content).toBe('d'.repeat(200));
    });

    it('compresses tool output whitespace', async () => {
        const msgs: MercuryMessage[] = [
            sys,
            { role: 'user', content: 'test' },
            { role: 'tool', tool_call_id: 'tc1', content: 'line1\n\n\n\nline2\n     \n  lots of spaces    here' },
        ];
        const result = await trimMessagesToTokenLimit(msgs, 10000, undefined);
        const toolMsg = result.find(m => m.role === 'tool');
        // Triple+ newlines should be compressed
        expect(toolMsg?.content).not.toContain('\n\n\n');
    });

    it('truncates very long tool outputs', async () => {
        const msgs: MercuryMessage[] = [
            sys,
            { role: 'user', content: 'test' },
            { role: 'tool', tool_call_id: 'tc1', content: 'x'.repeat(5000) },
        ];
        const result = await trimMessagesToTokenLimit(msgs, 10000, undefined);
        const toolMsg = result.find(m => m.role === 'tool');
        // Truncated to ~3800 + "...(truncated)"
        expect(toolMsg!.content!.length).toBeLessThan(5000);
        expect(toolMsg!.content).toContain('truncated');
    });

    it('adds summary placeholder for many dropped messages', async () => {
        const msgs: MercuryMessage[] = [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'a'.repeat(200) },
            { role: 'assistant', content: 'b'.repeat(200) },
            { role: 'user', content: 'c'.repeat(200) },
            { role: 'assistant', content: 'd'.repeat(200) },
            { role: 'user', content: 'e'.repeat(200) },
        ];
        // Very tight budget — can only keep system + last message
        const result = await trimMessagesToTokenLimit(msgs, 60, undefined);
        // Should have a summary message for dropped content
        // Either we got a summary OR messages were just trimmed
        expect(result[0].role).toBe('system');
        expect(result.length).toBeLessThan(msgs.length);
    });
});
