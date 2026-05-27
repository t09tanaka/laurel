import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  devGlyphs,
  emitDevEvent,
  formatBytes,
  formatPath,
  renderBanner,
  renderBuildComplete,
  renderReady,
  renderRebuild,
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
    expect(g.cycle).toBe('↻');
  });

  test('ASCII fallback when color is disabled (piped, NO_COLOR, etc.)', () => {
    setColorEnabled(false);
    const g = devGlyphs();
    expect(g.check).toBe('OK');
    expect(g.warn).toBe('WARN');
    expect(g.separator).toBe('-');
    expect(g.cycle).toBe('~');
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
    expect(
      renderRebuild({ routes: 1, assets: 0, elapsedMs: 1, changeType: 'reload', clients: 0 }),
    ).toBe('');
  });
});

describe('dev-banner — renderRebuild', () => {
  const originalColor = getColorEnabled();
  const originalMode = getOutputMode();
  beforeEach(() => setColorEnabled(false));
  afterEach(() => {
    setColorEnabled(originalColor);
    setOutputMode(originalMode);
  });

  test('renders glyph, route/asset counts, elapsed ms, and reload fragment', () => {
    const plain = stripAnsi(
      renderRebuild({ routes: 11, assets: 19, elapsedMs: 142, changeType: 'reload', clients: 1 }),
    );
    expect(plain).toContain('~ Rebuilt 11 routes (19 assets) in 142ms');
    expect(plain).toContain('pushed reload (1 client)');
  });

  test('CSS-only changes flip the trailing fragment to "pushed css"', () => {
    const plain = stripAnsi(
      renderRebuild({ routes: 11, assets: 19, elapsedMs: 87, changeType: 'css', clients: 2 }),
    );
    expect(plain).toContain('pushed css (2 clients)');
  });

  test('pluralises client label correctly', () => {
    const one = stripAnsi(
      renderRebuild({ routes: 1, assets: 0, elapsedMs: 10, changeType: 'reload', clients: 1 }),
    );
    expect(one).toContain('(1 client)');
    expect(one).not.toContain('clients)');
    const many = stripAnsi(
      renderRebuild({ routes: 1, assets: 0, elapsedMs: 10, changeType: 'reload', clients: 3 }),
    );
    expect(many).toContain('(3 clients)');
    const zero = stripAnsi(
      renderRebuild({ routes: 1, assets: 0, elapsedMs: 10, changeType: 'reload', clients: 0 }),
    );
    expect(zero).toContain('(0 clients)');
  });

  test('elapsed >= 1s switches to seconds (matches renderReady formatting)', () => {
    const plain = stripAnsi(
      renderRebuild({
        routes: 1,
        assets: 0,
        elapsedMs: 2500,
        changeType: 'reload',
        clients: 1,
      }),
    );
    expect(plain).toContain('in 2.50s');
  });

  test('uses Unicode cycle glyph when color is enabled', () => {
    setColorEnabled(true);
    const plain = stripAnsi(
      renderRebuild({ routes: 1, assets: 0, elapsedMs: 10, changeType: 'reload', clients: 1 }),
    );
    expect(plain).toContain('↻ Rebuilt');
  });
});

describe('dev-banner — formatBytes', () => {
  test('renders binary units with one decimal', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(1024)).toBe('1 KiB');
    expect(formatBytes(1536)).toBe('1.5 KiB');
    expect(formatBytes(1024 * 1024)).toBe('1 MiB');
    expect(formatBytes(Math.round(1.2 * 1024 * 1024))).toBe('1.2 MiB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GiB');
  });
});

describe('dev-banner — renderBuildComplete', () => {
  const originalColor = getColorEnabled();
  const originalMode = getOutputMode();
  beforeEach(() => setColorEnabled(false));
  afterEach(() => {
    setColorEnabled(originalColor);
    setOutputMode(originalMode);
  });

  test('renders Built header, elapsed time, counts, bytes and outputDir', () => {
    const text = renderBuildComplete({
      elapsedMs: 1234,
      routes: 11,
      assets: 19,
      bytes: Math.round(1.2 * 1024 * 1024),
      outputDir: 'dist/',
    });
    const plain = stripAnsi(text);
    expect(plain).toContain('OK Built in 1.23s');
    expect(plain).toContain('11 routes, 19 assets, 1.2 MiB');
    expect(plain).toContain('-> dist/');
  });

  test('omits bytes segment when undefined (dry run case)', () => {
    const text = renderBuildComplete({
      elapsedMs: 50,
      routes: 3,
      assets: 0,
      outputDir: 'dist/',
    });
    const plain = stripAnsi(text);
    expect(plain).toContain('OK Built in 50ms');
    expect(plain).toContain('3 routes, 0 assets -> dist/');
    expect(plain).not.toMatch(/MiB|KiB|GiB/);
  });

  test('honours custom label (watch-mode "Rebuilt")', () => {
    const text = renderBuildComplete({
      elapsedMs: 200,
      routes: 1,
      assets: 1,
      outputDir: 'dist/',
      label: 'Rebuilt',
    });
    expect(stripAnsi(text)).toContain('OK Rebuilt in 200ms');
  });

  test('uses Unicode glyphs when color is enabled', () => {
    setColorEnabled(true);
    const text = renderBuildComplete({
      elapsedMs: 100,
      routes: 1,
      assets: 1,
      bytes: 2048,
      outputDir: 'dist/',
    });
    const plain = stripAnsi(text);
    expect(plain).toContain('✓ Built in 100ms');
    expect(plain).toContain('→ dist/');
  });

  test('JSON output mode suppresses the block', () => {
    setOutputMode('json');
    expect(renderBuildComplete({ elapsedMs: 1, routes: 0, assets: 0, outputDir: 'dist/' })).toBe(
      '',
    );
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

  test('json mode: dev.rebuilt event carries rebuild fields', () => {
    setOutputMode('json');
    const written: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s) => {
      written.push(s);
      return true;
    };
    try {
      emitDevEvent('dev.rebuilt', {
        routes: 11,
        assets: 19,
        elapsedMs: 142,
        reuse: 'reused config+theme',
        changeType: 'reload',
        clients: 1,
      });
    } finally {
      (process.stdout as unknown as { write: typeof orig }).write = orig;
    }
    expect(written.length).toBe(1);
    const parsed = JSON.parse(written[0] ?? '{}') as Record<string, unknown>;
    expect(parsed.event).toBe('dev.rebuilt');
    expect(parsed.routes).toBe(11);
    expect(parsed.assets).toBe(19);
    expect(parsed.elapsedMs).toBe(142);
    expect(parsed.changeType).toBe('reload');
    expect(parsed.clients).toBe(1);
    expect(parsed.reuse).toBe('reused config+theme');
  });
});
