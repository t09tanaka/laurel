import { describe, expect, test } from 'bun:test';
import { detectDeployTargetFromEnv } from '~/cli/commands/deploy.ts';

describe('detectDeployTargetFromEnv', () => {
  test('returns undefined for an empty env', () => {
    expect(detectDeployTargetFromEnv({})).toBeUndefined();
  });

  test('NETLIFY=true -> netlify', () => {
    expect(detectDeployTargetFromEnv({ NETLIFY: 'true' })).toBe('netlify');
  });

  test('NETLIFY=1 -> netlify', () => {
    expect(detectDeployTargetFromEnv({ NETLIFY: '1' })).toBe('netlify');
  });

  test('VERCEL=1 -> vercel', () => {
    expect(detectDeployTargetFromEnv({ VERCEL: '1' })).toBe('vercel');
  });

  test('CF_PAGES=1 -> cloudflare', () => {
    expect(detectDeployTargetFromEnv({ CF_PAGES: '1' })).toBe('cloudflare');
  });

  test('GITHUB_ACTIONS=true + GITHUB_PAGES_* -> github-pages', () => {
    expect(
      detectDeployTargetFromEnv({
        GITHUB_ACTIONS: 'true',
        GITHUB_PAGES_TOKEN: 'x',
      }),
    ).toBe('github-pages');
  });

  test('GITHUB_ACTIONS=true alone is insufficient (Actions runs anywhere)', () => {
    expect(detectDeployTargetFromEnv({ GITHUB_ACTIONS: 'true' })).toBeUndefined();
  });

  test('netlify takes precedence when multiple signals coexist', () => {
    expect(
      detectDeployTargetFromEnv({
        NETLIFY: 'true',
        VERCEL: '1',
        CF_PAGES: '1',
      }),
    ).toBe('netlify');
  });

  test('falsy string values are treated as unset', () => {
    expect(detectDeployTargetFromEnv({ NETLIFY: '' })).toBeUndefined();
    expect(detectDeployTargetFromEnv({ VERCEL: 'false' })).toBeUndefined();
    expect(detectDeployTargetFromEnv({ CF_PAGES: '0' })).toBeUndefined();
  });

  test('GITHUB_PAGES_* with an empty value does not count', () => {
    expect(
      detectDeployTargetFromEnv({
        GITHUB_ACTIONS: 'true',
        GITHUB_PAGES_TOKEN: '',
      }),
    ).toBeUndefined();
  });
});
