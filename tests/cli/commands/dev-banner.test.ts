import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  devGlyphs,
  emitDevEvent,
  formatPath,
  renderBanner,
  renderReady,
  renderWarnings,
  summarizeWatching,
} from '~/cli/commands/dev-banner.ts';
import { getColorEnabled, getOutputMode, setColorEnabled, setOutputMode } from '~/util/logger.ts';

// Strip ANSI escapes so assertions can match plain strings regardless of
// whether color happens to be enabled in the host shell.
function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are exactly the control chars we want to remove.
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('dev-banner — formatPath', () => {
  test('cwd-relative for nested paths', () => {
    expect(formatPath('/a/b', '/a/b/c/d.toml')).toBe('c/d.toml');
  });

  test('returns "." when target equals cwd', () => {
    expect(formatPath('/a/b', '/a/b')).toBe('.');
  });

  test('keeps short ../ chains intact (one hop)', () => {
    expect(formatPath('/a/b/c', '/a/b/d')).toBe('../d');
  });

  test('keeps short ../ chains intact (two hops)', () => {
    expect(formatPath('/a/b/c', '/a/d')).toBe('../../d');
  });

  test('falls back to ~ shortening past two upward hops when in HOME', () => {
    const home = homedir();
    const deep = join(home, 'projects/site');
    const targetDeep = join(home, 'projects/other-place/foo');
    // cwd: ~/projects/site/very/deep/dir — needs many ../ to reach target
    const cwd = join(deep, 'very/deep/dir');
    const got = formatPath(cwd, targetDeep);
    expect(got.startsWith('~/')).toBe(true);
  });

  test('appends trailing slash when opts.trailingSlash is true', () => {
    expect(formatPath('/a/b', '/a/b/c', { trailingSlash: true })).toBe('c/');
  });

  test('does not double-add trailing slash', () => {
    expect(formatPath('/a/b', '/a/b/c/', { trailingSlash: true })).toBe('c/');
  });
});

describe('dev-banner — summarizeWatching', () => {
  test('collapses sibling content paths under their common parent', () => {
    const items = summarizeWatching('/site', [
      { path: '/site/content/posts', category: 'content' },
      { path: '/site/content/pages', category: 'content' },
      { path: '/site/content/tags', category: 'content' },
    ]);
    expect(items).toEqual(['content/']);
  });

  test('lists theme and config targets verbatim alongside content', () => {
    const items = summarizeWatching('/site', [
      { path: '/site/content/posts', category: 'content' },
      { path: '/site/content/pages', category: 'content' },
      { path: '/site/themes/source', category: 'theme' },
      { path: '/site/nectar.toml', category: 'config' },
    ]);
    expect(items).toEqual(['content/', 'themes/source/', 'nectar.toml']);
  });

  test('falls back to listing each content path when no common parent', () => {
    const items = summarizeWatching('/site', [
      { path: '/site/content-a/posts', category: 'content' },
      { path: '/site/content-b/pages', category: 'content' },
    ]);
    expect(items[0]).toContain('content-a/posts/');
    expect(items[0]).toContain('content-b/pages/');
  });
});

describe('dev-banner — devGlyphs', () => {
  const originalColor = getColorEnabled();
  afterEach(() => setColorEnabled(originalColor));

  test('Unicode glyphs when color is enabled (TTY-like)', () => {
    setColorEnabled(true);
    const g = devGlyphs();
    expect(g.check).toBe('✓');
    expect(g.warn).toBe('⚠');
    expect(g.separator).toBe('·');
  });

  test('ASCII fallback when color is disabled (piped, NO_COLOR, etc.)', () => {
    setColorEnabled(false);
    const g = devGlyphs();
    expect(g.check).toBe('OK');
    expect(g.warn).toBe('WARN');
    expect(g.separator).toBe('-');
  });
});

describe('dev-banner — renderBanner / renderReady / renderWarnings', () => {
  const originalColor = getColorEnabled();
  const originalMode = getOutputMode();
  beforeEach(() => setColorEnabled(false)); // deterministic ASCII output for matchers
  afterEach(() => {
    setColorEnabled(originalColor);
    setOutputMode(originalMode);
  });

  test('banner contains version, mode, and aligned label rows', () => {
    const text = renderBanner({
      version: '0.1.0',
      mode: 'dev',
      siteDir: 'docs-site',
      configFile: 'nectar.toml',
      themeName: 'source',
      outputDir: 'dist/',
      watching: ['content/', 'themes/source/', 'nectar.toml'],
    });
    const plain = stripAnsi(text);
    expect(plain).toContain('Nectar 0.1.0');
    expect(plain).toContain('dev mode');
    expect(plain).toContain('- Site:');
    expect(plain).toContain('docs-site');
    expect(plain).toContain('- Watching:');
    expect(plain).toContain('content/, themes/source/, nectar.toml');
  });

  test('ready block carries URL and route/asset counts', () => {
    const text = renderReady({
      elapsedMs: 312,
      url: 'http://localhost:4321/',
      routes: 11,
      assets: 19,
    });
    const plain = stripAnsi(text);
    expect(plain).toContain('Ready in 312ms');
    expect(plain).toContain('http://localhost:4321/');
    expect(plain).toContain('11 routes, 19 assets');
  });

  test('ready block adds Site URL only when differs from local', () => {
    const same = stripAnsi(
      renderReady({
        elapsedMs: 50,
        url: 'http://localhost:4321/',
        routes: 1,
        assets: 0,
        siteUrl: 'http://localhost:4321/',
      }),
    );
    expect(same).not.toContain('Site URL:');
    const diff = stripAnsi(
      renderReady({
        elapsedMs: 50,
        url: 'http://localhost:4321/',
        routes: 1,
        assets: 0,
        siteUrl: 'https://docs.example.com',
      }),
    );
    expect(diff).toContain('Site URL: https://docs.example.com');
  });

  test('elapsed > 1s switches to seconds with one decimal', () => {
    const plain = stripAnsi(
      renderReady({ elapsedMs: 2500, url: 'http://x/', routes: 1, assets: 1 }),
    );
    expect(plain).toContain('Ready in 2.50s');
  });

  test('warnings block pluralises and bullets each line', () => {
    const single = stripAnsi(renderWarnings(['only one']));
    expect(single).toContain('1 warning\n');
    expect(single).toContain('- only one');
    const many = stripAnsi(renderWarnings(['first', 'second']));
    expect(many).toContain('2 warnings');
    expect(many).toContain('- first');
    expect(many).toContain('- second');
  });

  test('empty warnings block renders nothing', () => {
    expect(renderWarnings([])).toBe('');
  });

  test('JSON output mode suppresses all banner blocks', () => {
    setOutputMode('json');
    expect(
      renderBanner({
        version: '0.1.0',
        mode: 'dev',
        siteDir: 'x',
        configFile: 'y',
        themeName: 'z',
        outputDir: 'd/',
        watching: [],
      }),
    ).toBe('');
    expect(renderReady({ elapsedMs: 1, url: 'http://x/', routes: 0, assets: 0 })).toBe('');
    expect(renderWarnings(['a'])).toBe('');
  });
});

describe('dev-banner — emitDevEvent', () => {
  const originalMode = getOutputMode();
  afterEach(() => setOutputMode(originalMode));

  test('text mode: emit is a no-op (no stdout output)', () => {
    setOutputMode('text');
    const written: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s) => {
      written.push(s);
      return true;
    };
    try {
      emitDevEvent('dev.ready', { port: 4321 });
    } finally {
      (process.stdout as unknown as { write: typeof orig }).write = orig;
    }
    expect(written).toEqual([]);
  });

  test('json mode: emits a JSON line including event name + fields', () => {
    setOutputMode('json');
    const written: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s) => {
      written.push(s);
      return true;
    };
    try {
      emitDevEvent('dev.ready', { port: 4321, routes: 11 });
    } finally {
      (process.stdout as unknown as { write: typeof orig }).write = orig;
    }
    expect(written.length).toBe(1);
    const parsed = JSON.parse(written[0] ?? '{}') as Record<string, unknown>;
    expect(parsed.event).toBe('dev.ready');
    expect(parsed.port).toBe(4321);
    expect(parsed.routes).toBe(11);
    expect(parsed.msg).toBe('dev.ready');
  });
});
