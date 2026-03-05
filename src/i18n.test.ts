/**
 * i18n.test.ts — Tests for internationalisation module
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { t, loadLocale, resetLocale, allKeys } from './i18n';

describe('i18n', () => {
    beforeEach(() => {
        resetLocale();
    });

    it('returns the English string for a known key', () => {
        expect(t('action.explain')).toBe('Explain');
    });

    it('returns the key itself for unknown keys', () => {
        expect(t('this.key.does.not.exist')).toBe('this.key.does.not.exist');
    });

    it('interpolates variables', () => {
        const result = t('error.streamStalled', { seconds: '30' });
        expect(result).toContain('30');
        expect(result).toContain('stalled');
    });

    it('handles multiple variables', () => {
        // 'error.generic' has {message}
        const result = t('error.generic', { message: 'something broke' });
        expect(result).toContain('something broke');
    });

    it('loadLocale overrides specific keys', () => {
        loadLocale({ 'action.explain': 'Expliquer' });
        expect(t('action.explain')).toBe('Expliquer');
        // Other keys unchanged
        expect(t('action.fix')).toBe('Fix');
    });

    it('resetLocale restores English defaults', () => {
        loadLocale({ 'action.explain': 'Overridden' });
        expect(t('action.explain')).toBe('Overridden');
        resetLocale();
        expect(t('action.explain')).toBe('Explain');
    });

    it('allKeys returns all defined keys', () => {
        const keys = allKeys();
        expect(keys.length).toBeGreaterThan(20);
        expect(keys).toContain('noProvider');
        expect(keys).toContain('action.explain');
        expect(keys).toContain('input.send');
    });

    it('no provider message is comprehensive', () => {
        const msg = t('noProvider');
        expect(msg).toContain('No provider');
    });

    it('welcome strings exist', () => {
        expect(t('welcome.title')).toContain('Lars');
        expect(t('welcome.subtitle')).toContain('Mercury');
    });
});
