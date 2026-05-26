import { describe, expect, test } from 'bun:test';
import { decideDevReuse } from '~/dev/incremental.ts';
import type { DevChangeCategory } from '~/dev/incremental.ts';

function set(...cats: DevChangeCategory[]): Set<DevChangeCategory> {
  return new Set(cats);
}

describe('decideDevReuse', () => {
  test('empty set forces a full reload — no signal means assume the worst', () => {
    expect(decideDevReuse(set())).toEqual({ reuseConfig: false, reuseTheme: false });
  });

  test('config change invalidates everything (nectar.toml can move paths)', () => {
    expect(decideDevReuse(set('config'))).toEqual({ reuseConfig: false, reuseTheme: false });
  });

  test('theme-only change keeps config, drops theme', () => {
    expect(decideDevReuse(set('theme'))).toEqual({ reuseConfig: true, reuseTheme: false });
  });

  test('content-only change keeps both — the happy path with the biggest win', () => {
    expect(decideDevReuse(set('content'))).toEqual({ reuseConfig: true, reuseTheme: true });
  });

  test('theme + content together keeps config only', () => {
    expect(decideDevReuse(set('theme', 'content'))).toEqual({
      reuseConfig: true,
      reuseTheme: false,
    });
  });

  test('config dominates even when paired with other categories', () => {
    expect(decideDevReuse(set('config', 'theme'))).toEqual({
      reuseConfig: false,
      reuseTheme: false,
    });
    expect(decideDevReuse(set('config', 'content'))).toEqual({
      reuseConfig: false,
      reuseTheme: false,
    });
  });
});
