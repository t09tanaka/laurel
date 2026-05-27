import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  countContentFiles,
  devGlyphs,
  emitStartupEvent,
  findActiveConfigDisplay,
  formatBytes,
  formatContentCounts,
  formatPath,
  renderBanner,
  renderBuildComplete,
  renderNotice,
  renderReady,
  renderRebuild,
  renderSimpleReady,
  renderWarnings,
  summarizeWatching,
} from '~/cli/commands/startup-banner.ts';
import { getColorEnabled, getOutputMode, setColorEnabled, setOutputMode } from '~/util/logger.ts';

// Strip ANSI escapes so assertions can match plain strings regardless of
// whether color happens to be enabled in the host shell.
function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are exactly the control chars we want to remove.
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('startup-banner — formatPath', () => {
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

describe('startup-banner — summarizeWatching', () => {
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

describe('startup-banner — devGlyphs', () => {
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

describe('startup-banner — renderBanner / renderReady / renderWarnings', () => {
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
      mode: 'dev mode',
      rows: [
        ['Site', 'docs-site'],
        ['Config', 'nectar.toml'],
        ['Theme', 'source'],
        ['Output', 'dist/'],
        ['Watching', 'content/, themes/source/, nectar.toml'],
      ],
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
        mode: 'dev mode',
        rows: [],
      }),
    ).toBe('');
    expect(renderReady({ elapsedMs: 1, url: 'http://x/', routes: 0, assets: 0 })).toBe('');
    expect(renderWarnings(['a'])).toBe('');
    expect(
      renderRebuild({ routes: 1, assets: 0, elapsedMs: 1, changeType: 'reload', clients: 0 }),
    ).toBe('');
  });
});

describe('startup-banner — renderRebuild', () => {
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

describe('startup-banner — formatBytes', () => {
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

describe('startup-banner — renderBuildComplete', () => {
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

describe('startup-banner — emitStartupEvent', () => {
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
      emitStartupEvent('dev.ready', { port: 4321 });
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
      emitStartupEvent('dev.ready', { port: 4321, routes: 11 });
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
      emitStartupEvent('dev.rebuilt', {
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

describe('startup-banner — renderSimpleReady', () => {
  const originalColor = getColorEnabled();
  const originalMode = getOutputMode();
  beforeEach(() => setColorEnabled(false));
  afterEach(() => {
    setColorEnabled(originalColor);
    setOutputMode(originalMode);
  });

  test('renders Ready line with URL but no timing or counts', () => {
    const plain = stripAnsi(renderSimpleReady({ url: 'http://127.0.0.1:4322/' }));
    expect(plain).toContain('Ready');
    expect(plain).toContain('http://127.0.0.1:4322/');
    expect(plain).not.toContain('Ready in');
    expect(plain).not.toContain('routes');
  });

  test('appends Site URL row only when configured and different from local', () => {
    const same = stripAnsi(renderSimpleReady({ url: 'http://x/', siteUrl: 'http://x/' }));
    expect(same).not.toContain('Site URL:');
    const diff = stripAnsi(
      renderSimpleReady({ url: 'http://127.0.0.1:4322/', siteUrl: 'https://nectar.dev' }),
    );
    expect(diff).toContain('Site URL: https://nectar.dev');
  });

  test('JSON mode returns empty string', () => {
    setOutputMode('json');
    expect(renderSimpleReady({ url: 'http://x/' })).toBe('');
  });
});

describe('startup-banner — renderNotice', () => {
  const originalColor = getColorEnabled();
  const originalMode = getOutputMode();
  beforeEach(() => setColorEnabled(false));
  afterEach(() => {
    setColorEnabled(originalColor);
    setOutputMode(originalMode);
  });

  test('warning notice carries the WARN glyph', () => {
    const plain = stripAnsi(renderNotice('warning', 'careful here'));
    expect(plain).toContain('WARN');
    expect(plain).toContain('careful here');
  });

  test('info notice uses the dim separator glyph instead of WARN', () => {
    const plain = stripAnsi(renderNotice('info', 'fyi'));
    expect(plain).not.toContain('WARN');
    expect(plain).toContain('fyi');
  });

  test('JSON mode returns empty string', () => {
    setOutputMode('json');
    expect(renderNotice('warning', 'silenced')).toBe('');
  });
});

describe('startup-banner — formatContentCounts', () => {
  test('English pluralisation per kind, keeping zero counts', () => {
    expect(formatContentCounts({ posts: 1, pages: 7, components: 0, authors: 1, tags: 1 })).toBe(
      '1 post, 7 pages, 0 components, 1 author, 1 tag',
    );
  });
});

describe('startup-banner — countContentFiles', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nectar-banner-counts-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('counts top-level .md files per kind and skips missing dirs', async () => {
    await mkdir(join(dir, 'content/posts'), { recursive: true });
    await writeFile(join(dir, 'content/posts/a.md'), '');
    await writeFile(join(dir, 'content/posts/b.md'), '');
    await writeFile(join(dir, 'content/posts/c.txt'), ''); // wrong ext, ignored
    await writeFile(join(dir, 'content/posts/.hidden.md'), ''); // dotfile, ignored
    await mkdir(join(dir, 'content/pages'), { recursive: true });
    await writeFile(join(dir, 'content/pages/one.md'), '');

    const counts = await countContentFiles(dir, {
      posts_dir: 'content/posts',
      pages_dir: 'content/pages',
      components_dir: 'content/components',
      authors_dir: 'content/authors',
      tags_dir: 'content/tags',
    });

    expect(counts).toEqual({ posts: 2, pages: 1, components: 0, authors: 0, tags: 0 });
  });
});

describe('startup-banner — findActiveConfigDisplay', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nectar-banner-cfg-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('echoes explicit --config argument as cwd-relative path', () => {
    expect(findActiveConfigDisplay(dir, 'sites/main/nectar.toml')).toBe('sites/main/nectar.toml');
  });

  test('prefers nectar.toml when both .toml and .config.toml exist', async () => {
    await writeFile(join(dir, 'nectar.toml'), '');
    await writeFile(join(dir, 'nectar.config.toml'), '');
    expect(findActiveConfigDisplay(dir, undefined)).toBe('nectar.toml');
  });

  test('falls through discovery order when canonical name is missing', async () => {
    await writeFile(join(dir, 'nectar.config.toml'), '');
    expect(findActiveConfigDisplay(dir, undefined)).toBe('nectar.config.toml');
  });

  test('returns canonical name when no config file is present', () => {
    expect(findActiveConfigDisplay(dir, undefined)).toBe('nectar.toml');
  });
});
