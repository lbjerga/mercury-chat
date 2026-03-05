/**
 * providers.test.ts — Unit tests for provider error classification
 */
import { describe, it, expect } from 'vitest';
import { classifyError, isRetryableError, ErrorKind, PROVIDER_PRICING } from './providers/types';

describe('classifyError', () => {
    it('detects rate limit errors', () => {
        expect(classifyError(new Error('429 Too Many Requests'))).toBe('rate-limit');
        expect(classifyError(new Error('Rate limit exceeded'))).toBe('rate-limit');
    });

    it('detects auth errors', () => {
        expect(classifyError(new Error('401 Unauthorized'))).toBe('auth');
        expect(classifyError(new Error('403 Forbidden'))).toBe('auth');
    });

    it('detects timeout errors', () => {
        expect(classifyError(new Error('408 Request Timeout'))).toBe('timeout');
        expect(classifyError(new Error('Request timed out'))).toBe('timeout');
    });

    it('detects server errors', () => {
        expect(classifyError(new Error('500 Internal Server Error'))).toBe('server');
        expect(classifyError(new Error('502 Bad Gateway'))).toBe('server');
    });

    it('detects network errors', () => {
        expect(classifyError(new Error('ECONNREFUSED'))).toBe('network');
        expect(classifyError(new Error('ENOTFOUND'))).toBe('network');
    });

    it('returns unknown for unrecognized errors', () => {
        expect(classifyError(new Error('Something went wrong'))).toBe('unknown');
    });

    it('handles non-Error values', () => {
        expect(classifyError('429 rate limit')).toBe('rate-limit');
        expect(classifyError(42)).toBe('unknown');
    });
});

describe('isRetryableError', () => {
    const retryable: ErrorKind[] = ['rate-limit', 'timeout', 'server', 'network'];
    const notRetryable: ErrorKind[] = ['auth', 'unsupported', 'unknown'];

    for (const kind of retryable) {
        it(`${kind} is retryable`, () => {
            expect(isRetryableError(kind)).toBe(true);
        });
    }

    for (const kind of notRetryable) {
        it(`${kind} is not retryable`, () => {
            expect(isRetryableError(kind)).toBe(false);
        });
    }
});

describe('PROVIDER_PRICING', () => {
    it('has entries for all providers', () => {
        expect(PROVIDER_PRICING).toHaveProperty('copilot');
        expect(PROVIDER_PRICING).toHaveProperty('openrouter');
        expect(PROVIDER_PRICING).toHaveProperty('ollama');
        expect(PROVIDER_PRICING).toHaveProperty('mercury');
    });

    it('copilot is free', () => {
        expect(PROVIDER_PRICING.copilot.inputPer1M).toBe(0);
        expect(PROVIDER_PRICING.copilot.outputPer1M).toBe(0);
    });

    it('mercury has positive pricing', () => {
        expect(PROVIDER_PRICING.mercury.inputPer1M).toBeGreaterThan(0);
        expect(PROVIDER_PRICING.mercury.outputPer1M).toBeGreaterThan(0);
    });
});
