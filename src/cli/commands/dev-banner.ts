import { homedir } from 'node:os';
import { dirname, relative as pathRelative } from 'node:path';
import { colorize, getColorEnabled, getOutputMode, logger } from '~/util/logger.ts';

// Decoration glyphs used by the dev startup blocks. We treat
// "color disabled" as a proxy for "minimal terminal" -- users who set
// NO_COLOR or pipe nectar through a log collector almost always want plain
// ASCII as well, and falling back keeps the same predicate driving every
// stylistic choice.
export interface DevGlyphs {
  check: string;
  warn: string;
  separator: string;
  arrow: string;
  bullet: string;
  cycle: string;
}

export function devGlyphs(): DevGlyphs {
  if (!getColorEnabled()) {
    return { check: 'OK', warn: 'WARN', separator: '-', arrow: '->', bullet: '-', cycle: '~' };
  }
  return { check: '✓', warn: '⚠', separator: '·', arrow: '→', bullet: '-', cycle: '↻' };
}

// Display path: cwd-relative when the target sits inside cwd, `~`-shortened
// when it lives in the user's home directory, otherwise the absolute path.
// `trailingSlash` appends a `/` when the path represents a directory so the
// banner can hint at file-vs-directory at a glance without us calling
// `fs.stat`. The flag is opt-in because nectar.toml etc. are intentionally
// rendered without the trailing slash.
export function formatPath(
  cwd: string,
  target: string,
  opts?: { trailingSlash?: boolean },
): string {
  const rel = pathRelative(cwd, target);
  // Prefer relative form (including `../` chains) so contributors see the
  // same shape that appears in build error messages and source maps. Fall
  // back to `~` shortening only when the relative form requires more than
  // two upward hops -- past that point the absolute form is shorter and
  // more readable.
  let display: string;
  if (rel === '') {
    display = '.';
  } else if (countLeadingUpHops(rel) <= 2) {
    display = rel;
  } else {
    const home = homedir();
    display = target.startsWith(`${home}/`) || target === home ? target.replace(home, '~') : target;
  }
  if (opts?.trailingSlash === true && !display.endsWith('/')) display = `${display}/`;
  return display;
}

// Roll up the watch-target list into the short, human-readable strings shown
// after `Watching:`. The collapse logic only kicks in for content-category
// targets because they're almost always siblings under a single `content/`
// directory and listing all five would dominate the banner. Theme and config
// targets stay verbatim -- they're singletons in practice and the reader
// usually does want to see the exact path.
export function summarizeWatching(
  cwd: string,
  targets: ReadonlyArray<{ path: string; category: 'content' | 'theme' | 'config' }>,
): string[] {
  const contentPaths = targets
    .filter((t) => t.category === 'content')
    .map((t) => formatPath(cwd, t.path, { trailingSlash: true }));
  const items: string[] = [];
  if (contentPaths.length > 0) {
    const collapsed = collapseToCommonParent(contentPaths);
    items.push(collapsed ?? contentPaths.join(', '));
  }
  for (const t of targets) {
    if (t.category === 'theme') items.push(formatPath(cwd, t.path, { trailingSlash: true }));
  }
  for (const t of targets) {
    if (t.category === 'config') items.push(formatPath(cwd, t.path));
  }
  return items;
}

function countLeadingUpHops(relPath: string): number {
  let n = 0;
  for (const segment of relPath.split('/')) {
    if (segment === '..') n += 1;
    else break;
  }
  return n;
}

function collapseToCommonParent(paths: string[]): string | null {
  if (paths.length < 2) return paths[0] ?? null;
  const parent = dirname(paths[0] ?? '');
  for (const p of paths.slice(1)) {
    if (dirname(p) !== parent) return null;
    if (parent === '.' || parent === '/') return null;
  }
  return parent === '' ? null : `${parent}/`;
}

export interface BannerMeta {
  version: string;
  mode: string;
  siteDir: string;
  configFile: string;
  themeName: string;
  outputDir: string;
  watching: string[];
}

export function renderBanner(meta: BannerMeta): string {
  if (getOutputMode() === 'json') return '';
  const dim = (s: string) => colorize(s, 'gray');
  const accent = (s: string) => colorize(s, 'cyan');
  const g = devGlyphs();
  const header = `${accent('Nectar')} ${meta.version}  ${dim(g.separator)}  ${dim(`${meta.mode} mode`)}`;
  const rows: Array<[string, string]> = [
    ['Site', meta.siteDir],
    ['Config', meta.configFile],
    ['Theme', meta.themeName],
    ['Output', meta.outputDir],
    ['Watching', meta.watching.join(', ')],
  ];
  const labelWidth = rows.reduce((w, [k]) => Math.max(w, k.length), 0);
  const body = rows
    .map(([k, v]) => `   ${dim('-')} ${dim(`${k}:`.padEnd(labelWidth + 1))} ${v}`)
    .join('\n');
  return `\n   ${header}\n\n${body}\n`;
}

export interface ReadyBlock {
  elapsedMs: number;
  url: string;
  routes: number;
  assets: number;
  siteUrl?: string;
}

export function renderReady(ready: ReadyBlock): string {
  if (getOutputMode() === 'json') return '';
  const g = devGlyphs();
  const dim = (s: string) => colorize(s, 'gray');
  const ok = (s: string) => colorize(s, 'green');
  const link = (s: string) => colorize(s, 'cyan');
  const head = ` ${ok(g.check)} Ready in ${formatMs(ready.elapsedMs)}  ${dim(g.separator)}  ${link(ready.url)}`;
  const lines = [head, `   ${dim(`${ready.routes} routes, ${ready.assets} assets`)}`];
  if (ready.siteUrl !== undefined && ready.siteUrl.length > 0 && ready.siteUrl !== ready.url) {
    lines.push(`   ${dim('Site URL:')} ${ready.siteUrl}`);
  }
  return `\n${lines.join('\n')}\n`;
}

export function renderWarnings(messages: string[]): string {
  if (getOutputMode() === 'json') return '';
  if (messages.length === 0) return '';
  const g = devGlyphs();
  const head = ` ${colorize(g.warn, 'yellow')} ${messages.length} warning${messages.length === 1 ? '' : 's'}`;
  const bullets = messages.map((m) => `   ${colorize(g.bullet, 'gray')} ${m}`);
  return `\n${[head, ...bullets].join('\n')}\n`;
}

export interface RebuildBlock {
  routes: number;
  assets: number;
  elapsedMs: number;
  changeType: 'reload' | 'css';
  clients: number;
}

// Watch-loop rebuild log. Same visual family as renderReady -- glyph + accented
// summary + dim separator + dim trailing fragment -- but emitted as a single
// line because it fires on every file change and a multi-line block would
// quickly dominate the terminal. The trailing "pushed reload/css (N client)"
// fragment captures what the previous `pushing reload to N client(s)` wording
// did, just shorter. We intentionally drop the "reused config+theme" hint
// here: it doesn't change between rebuilds in the common case and the time
// delta is the more useful signal to track on each cycle.
export function renderRebuild(block: RebuildBlock): string {
  if (getOutputMode() === 'json') return '';
  const g = devGlyphs();
  const dim = (s: string) => colorize(s, 'gray');
  const accent = (s: string) => colorize(s, 'cyan');
  const head = `${accent(g.cycle)} Rebuilt ${block.routes} routes (${block.assets} assets) in ${formatMs(block.elapsedMs)}`;
  const pushLabel = block.changeType === 'css' ? 'pushed css' : 'pushed reload';
  const clientLabel = `${block.clients} ${block.clients === 1 ? 'client' : 'clients'}`;
  return `\n ${head}  ${dim(g.separator)}  ${dim(`${pushLabel} (${clientLabel})`)}\n`;
}

// Final summary block emitted at the end of `nectar build`. Mirrors the dev
// "Ready" block stylistically so contributors see the same finish-line shape
// whether they're iterating in dev or shipping a one-shot build. `bytes` is
// optional because dry runs intentionally don't compute output size.
export interface BuildCompleteBlock {
  elapsedMs: number;
  routes: number;
  assets: number;
  bytes?: number;
  outputDir: string;
  // Override label so watch-mode rebuilds can read "Rebuilt" instead of
  // "Built" while reusing the same render path.
  label?: string;
}

export function renderBuildComplete(block: BuildCompleteBlock): string {
  if (getOutputMode() === 'json') return '';
  const g = devGlyphs();
  const dim = (s: string) => colorize(s, 'gray');
  const ok = (s: string) => colorize(s, 'green');
  const label = block.label ?? 'Built';
  const head = ` ${ok(g.check)} ${label} in ${formatMs(block.elapsedMs)}`;
  const parts = [`${block.routes} routes`, `${block.assets} assets`];
  if (block.bytes !== undefined) parts.push(formatBytes(block.bytes));
  const detail = `${parts.join(', ')} ${g.arrow} ${block.outputDir}`;
  return `\n${head}\n   ${dim(detail)}\n`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  return `${s.toFixed(s < 10 ? 2 : 1)}s`;
}

// Mirrors the binary-units formatter in src/cli/commands/build.ts so the
// build block prints the same "1.2 MiB" shape contributors are used to. Kept
// here so the banner module owns the entire build-complete rendering surface
// without forcing the build command to expose its private helper.
export function formatBytes(bytes: number): string {
  const gib = 1024 * 1024 * 1024;
  const mib = 1024 * 1024;
  const kib = 1024;
  if (bytes >= gib) return `${roundToOneDecimal(bytes / gib)} GiB`;
  if (bytes >= mib) return `${roundToOneDecimal(bytes / mib)} MiB`;
  if (bytes >= kib) return `${roundToOneDecimal(bytes / kib)} KiB`;
  if (bytes === 1) return '1 B';
  if (bytes >= 0) return `${bytes} B`;
  return `${roundToOneDecimal(bytes / mib)} MiB`;
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

// Direct stdout write for banner / ready / warnings blocks. Bypasses the
// logger to keep tag-free output (no `[info]` prefix) while still respecting
// JSON output mode -- the render* functions return '' in JSON mode, so this
// becomes a no-op there.
export function writeBlock(text: string): void {
  if (text.length === 0) return;
  process.stdout.write(text);
}

// JSON-mode structured event emitter. Threads fields through `logger.info`
// so the existing JSON formatter wraps them in the {ts, level, msg, ...}
// envelope CI consumers already parse. No-op in text mode because the banner
// blocks cover the human surface.
export function emitDevEvent(name: string, fields: Record<string, unknown>): void {
  if (getOutputMode() !== 'json') return;
  logger.info(name, { event: name, ...fields });
}
