import { describe, expect, test } from 'bun:test';
import { directionForLocale } from '~/util/locale.ts';

describe('directionForLocale', () => {
  test('returns ltr for English and CJK locales', () => {
    expect(directionForLocale('en')).toBe('ltr');
    expect(directionForLocale('en-US')).toBe('ltr');
    expect(directionForLocale('ja')).toBe('ltr');
    expect(directionForLocale('zh-Hant')).toBe('ltr');
    expect(directionForLocale('ko_KR')).toBe('ltr');
  });

  test('returns rtl for Arabic, Hebrew, Persian, Urdu, and friends', () => {
    expect(directionForLocale('ar')).toBe('rtl');
    expect(directionForLocale('ar-EG')).toBe('rtl');
    expect(directionForLocale('he')).toBe('rtl');
    expect(directionForLocale('fa-IR')).toBe('rtl');
    expect(directionForLocale('ur')).toBe('rtl');
    expect(directionForLocale('ps')).toBe('rtl');
    expect(directionForLocale('yi')).toBe('rtl');
  });

  test('handles weird inputs by defaulting to ltr', () => {
    expect(directionForLocale('')).toBe('ltr');
    expect(directionForLocale(undefined)).toBe('ltr');
    expect(directionForLocale(null)).toBe('ltr');
    expect(directionForLocale('xx-YY')).toBe('ltr');
  });

  test('is case-insensitive on the primary tag', () => {
    expect(directionForLocale('AR')).toBe('rtl');
    expect(directionForLocale('He-IL')).toBe('rtl');
  });
});
