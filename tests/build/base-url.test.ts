import { describe, expect, test } from 'bun:test';
import { normalizeBaseUrl } from '~/build/base-url.ts';

describe('normalizeBaseUrl', () => {
  test('accepts an https URL unchanged', () => {
    expect(normalizeBaseUrl('https://pr-42.example.com')).toBe('https://pr-42.example.com');
  });

  test('accepts an http URL unchanged', () => {
    expect(normalizeBaseUrl('http://localhost:4321')).toBe('http://localhost:4321');
  });

  test('strips a trailing slash for byte-identity with config-loaded site.url', () => {
    expect(normalizeBaseUrl('https://pr-42.example.com/')).toBe('https://pr-42.example.com');
  });

  test('strips multiple trailing slashes', () => {
    expect(normalizeBaseUrl('https://pr-42.example.com///')).toBe('https://pr-42.example.com');
  });

  test('trims surrounding whitespace', () => {
    expect(normalizeBaseUrl('  https://pr-42.example.com  ')).toBe('https://pr-42.example.com');
  });

  test('preserves a port', () => {
    expect(normalizeBaseUrl('http://localhost:8080')).toBe('http://localhost:8080');
  });

  test('preserves a sub-path on the host (Netlify deploy-preview shape)', () => {
    expect(normalizeBaseUrl('https://deploy-preview-42--site.netlify.app/preview')).toBe(
      'https://deploy-preview-42--site.netlify.app/preview',
    );
  });

  test('rejects a path-only value (would silently break canonical URLs)', () => {
    expect(() => normalizeBaseUrl('/preview')).toThrow(/http:\/\/ or https:\/\//);
  });

  test('rejects a host without scheme', () => {
    expect(() => normalizeBaseUrl('pr-42.example.com')).toThrow(/http:\/\/ or https:\/\//);
  });

  test('rejects unsupported schemes (ftp, file, javascript)', () => {
    expect(() => normalizeBaseUrl('ftp://example.com')).toThrow(/http:\/\/ or https:\/\//);
    expect(() => normalizeBaseUrl('file:///etc/passwd')).toThrow(/http:\/\/ or https:\/\//);
    expect(() => normalizeBaseUrl('javascript:alert(1)')).toThrow(/http:\/\/ or https:\/\//);
  });

  test('rejects empty string', () => {
    expect(() => normalizeBaseUrl('')).toThrow(/must not be empty/);
  });

  test('rejects whitespace-only string', () => {
    expect(() => normalizeBaseUrl('   ')).toThrow(/must not be empty/);
  });

  test('rejects a non-string value', () => {
    expect(() => normalizeBaseUrl(42 as unknown as string)).toThrow(/must be a string/);
  });

  test('rejects an https:// prefix with no hostname', () => {
    expect(() => normalizeBaseUrl('https://')).toThrow();
  });
});
