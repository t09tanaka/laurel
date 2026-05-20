import { describe, expect, test } from 'bun:test';
import { detectCliLocale, t } from '~/cli/i18n/index.ts';

describe('cli i18n', () => {
  test('detects supported locales from LC_MESSAGES before LANG', () => {
    expect(detectCliLocale({ LC_MESSAGES: 'en_US.UTF-8', LANG: 'fr_FR.UTF-8' })).toBe('en');
  });

  test('falls back to en for unsupported locales', () => {
    expect(detectCliLocale({ LC_MESSAGES: 'ja_JP.UTF-8', LANG: 'fr_FR.UTF-8' })).toBe('en');
    expect(detectCliLocale({ LANG: '' })).toBe('en');
  });

  test('interpolates message parameters from the en catalog', () => {
    expect(t('new.created', { path: '/tmp/post.md' }, 'en')).toBe('Created /tmp/post.md');
    expect(t('serve.invalidPort', { value: '80.5' }, 'en')).toBe(
      'Invalid --port value: 80.5 (expected an integer in 1..65535)',
    );
  });
});
