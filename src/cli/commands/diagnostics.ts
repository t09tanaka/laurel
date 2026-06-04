import { existsSync, lstatSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { BUILD_MANIFEST_DIR, BUILD_MANIFEST_FILENAME } from '~/build/build-manifest.ts';
import { MANIFEST_FILENAME } from '~/build/manifest.ts';
import { loadConfig } from '~/config/loader.ts';
import type { LaurelConfig } from '~/config/schema.ts';
import { loadTheme } from '~/theme/loader.ts';
import type { ThemeBundle } from '~/theme/types.ts';
import { ensureDir, pathContainsSymlink, scanGlob } from '~/util/fs.ts';
import { getLaurelVersion } from '~/util/laurel-version.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { DIAGNOSTICS_SPEC } from '../specs.ts';

const DEFAULT_LOG_LINES = 200;
const REDACTED = '[REDACTED]';
const TAR_BLOCK_SIZE = 512;

interface DiagnosticsBundleResult {
  output: string;
  entries: string[];
  bytes?: number;
  dryRun: boolean;
}

interface BundleOptions {
  cwd: string;
  configPath?: string | undefined;
  output?: string | undefined;
  logLines: number;
  dryRun: boolean;
  now?: Date | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

interface TarEntry {
  path: string;
  body: Uint8Array;
  mode?: number;
  mtime?: Date;
}

export async function runDiagnostics(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(DIAGNOSTICS_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(DIAGNOSTICS_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(DIAGNOSTICS_SPEC));
    return 0;
  }

  const subcommand = parsed.positionals[0];
  if (subcommand !== 'bundle') {
    process.stderr.write(
      `Unknown diagnostics subcommand: ${subcommand ?? '<missing>'}. Expected \`bundle\`.\n`,
    );
    return 2;
  }

  const logLines = parseLogLines(parsed.values['log-lines']);
  const asJson = parsed.values.json === true;
  const dryRun = parsed.values['dry-run'] === true || parsed.values.list === true;
  const output = typeof parsed.values.output === 'string' ? parsed.values.output : undefined;
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;

  try {
    const result = await createDiagnosticsBundle({
      cwd: process.cwd(),
      configPath,
      output,
      logLines,
      dryRun,
      env: process.env,
    });
    if (asJson) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (dryRun) {
      process.stdout.write(renderDryRun(result));
    } else {
      process.stdout.write(
        `Wrote diagnostics bundle to ${result.output} (${result.entries.length} files).\n`,
      );
    }
    return 0;
  } catch (err) {
    reportError(err, process.cwd());
    return 1;
  }
}

export async function createDiagnosticsBundle(
  options: BundleOptions,
): Promise<DiagnosticsBundleResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const config = await loadConfig({ cwd: options.cwd, configPath: options.configPath, env });
  const output = resolveOutputPath(options.cwd, options.output, now);
  const entries = await buildDiagnosticEntries({
    cwd: options.cwd,
    config,
    configPath: options.configPath,
    output,
    logLines: options.logLines,
    now,
    env,
  });

  const names = entries.map((entry) => entry.path);
  if (options.dryRun) {
    return { output, entries: names, dryRun: true };
  }

  const archive = createTarGz(entries);
  await ensureDir(dirname(output));
  await Bun.write(output, archive);
  return { output, entries: names, bytes: archive.byteLength, dryRun: false };
}

async function buildDiagnosticEntries(options: {
  cwd: string;
  config: LaurelConfig;
  configPath?: string | undefined;
  output: string;
  logLines: number;
  now: Date;
  env: NodeJS.ProcessEnv;
}): Promise<TarEntry[]> {
  const outputDir = resolveProjectPath(options.cwd, options.config.build.output_dir);
  const theme = await loadThemeSafely(options.cwd, options.config);
  const payloads: Array<{ path: string; value: unknown }> = [
    {
      path: 'diagnostics/metadata.json',
      value: {
        schema_version: 1,
        generated_at: options.now.toISOString(),
        laurel: { version: await getLaurelVersion() },
        cwd: options.cwd,
        output: options.output,
        config_path: options.configPath ?? null,
      },
    },
    {
      path: 'diagnostics/config/resolved-config.json',
      value: redactDiagnosticValue(options.config),
    },
    {
      path: 'diagnostics/content/files.json',
      value: await collectContentFileList(options.cwd, options.config),
    },
    {
      path: 'diagnostics/theme/manifest.json',
      value: theme
        ? await buildThemeManifest(options.cwd, theme)
        : { error: 'theme could not be loaded' },
    },
    {
      path: 'diagnostics/build/manifests.json',
      value: await collectBuildManifests(outputDir),
    },
    {
      path: 'diagnostics/logs/last-lines.json',
      value: await collectLogLines(options.cwd, outputDir, options.logLines, options.env),
    },
    {
      path: 'diagnostics/env/redacted-env.json',
      value: redactEnv(options.env),
    },
  ];

  const index = payloads.map((payload) => ({ path: payload.path }));
  payloads.unshift({ path: 'diagnostics/index.json', value: { entries: index } });

  return payloads.map((payload) => ({
    path: payload.path,
    body: new TextEncoder().encode(`${JSON.stringify(payload.value, null, 2)}\n`),
    mode: 0o600,
  }));
}

async function loadThemeSafely(
  cwd: string,
  config: LaurelConfig,
): Promise<ThemeBundle | undefined> {
  try {
    return await loadTheme({ cwd, config });
  } catch {
    return undefined;
  }
}

async function collectContentFileList(
  cwd: string,
  config: LaurelConfig,
): Promise<{
  roots: Array<{ kind: string; path: string; exists: boolean }>;
  files: FileEntry[];
  skipped: Array<{ path: string; reason: string }>;
}> {
  const roots = [
    { kind: 'posts', path: config.content.posts_dir, pattern: '**/*.md' },
    { kind: 'pages', path: config.content.pages_dir, pattern: '**/*.md' },
    { kind: 'authors', path: config.content.authors_dir, pattern: '**/*.md' },
    { kind: 'tags', path: config.content.tags_dir, pattern: '**/*.md' },
    { kind: 'assets', path: config.content.assets_dir, pattern: '**/*' },
    { kind: 'static', path: config.content.static_dir, pattern: '**/*' },
  ];
  const files: FileEntry[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const rootSummaries: Array<{ kind: string; path: string; exists: boolean }> = [];

  for (const root of roots) {
    const abs = resolveProjectPath(cwd, root.path);
    rootSummaries.push({ kind: root.kind, path: toProjectRel(cwd, abs), exists: existsSync(abs) });
    if (!existsSync(abs)) continue;
    const rels = await scanGlob(root.pattern, { cwd: abs, onlyFiles: true });
    for (const rel of rels) {
      const normalized = toPosix(rel);
      const absFile = join(abs, normalized);
      const projectRel = toProjectRel(cwd, absFile);
      if (pathContainsSymlink(abs, normalized)) {
        skipped.push({ path: projectRel, reason: 'symlinked path component' });
        continue;
      }
      files.push(fileEntry(root.kind, cwd, absFile));
    }
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { roots: rootSummaries, files, skipped };
}

interface FileEntry {
  kind: string;
  path: string;
  size: number;
  mtime_ms: number;
}

function fileEntry(kind: string, cwd: string, absFile: string): FileEntry {
  const stat = lstatSync(absFile);
  return {
    kind,
    path: toProjectRel(cwd, absFile),
    size: stat.size,
    mtime_ms: stat.mtimeMs,
  };
}

async function buildThemeManifest(cwd: string, theme: ThemeBundle): Promise<unknown> {
  const files = await collectThemeFiles(cwd, theme.rootDir);
  return {
    name: theme.name,
    root: toProjectRel(cwd, theme.rootDir),
    package: redactDiagnosticValue({
      name: theme.pkg.name,
      version: theme.pkg.version,
      posts_per_page: theme.pkg.posts_per_page,
      image_sizes: theme.pkg.image_sizes,
      card_assets: theme.pkg.card_assets,
      custom: theme.pkg.custom,
    }),
    templates: Object.keys(theme.templates).sort(),
    partials: Object.keys(theme.partials).sort(),
    locales: Object.keys(theme.locales).sort(),
    assets: [...theme.assets.values()]
      .map((asset) => ({
        logical_path: asset.logicalPath,
        fingerprinted_path: asset.fingerprintedPath,
        size: asset.size,
      }))
      .sort((a, b) =>
        a.logical_path < b.logical_path ? -1 : a.logical_path > b.logical_path ? 1 : 0,
      ),
    files,
  };
}

async function collectThemeFiles(cwd: string, rootDir: string): Promise<FileEntry[]> {
  if (!existsSync(rootDir)) return [];
  const rels = await scanGlob('**/*', { cwd: rootDir, onlyFiles: true });
  return rels
    .filter((rel) => !pathContainsSymlink(rootDir, rel))
    .map((rel) => fileEntry('theme', cwd, join(rootDir, rel)))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

async function collectBuildManifests(outputDir: string): Promise<{
  output_dir: string;
  files: Array<{ path: string; exists: boolean; value?: unknown }>;
}> {
  const candidates = [
    join(outputDir, BUILD_MANIFEST_DIR, BUILD_MANIFEST_FILENAME),
    join(outputDir, MANIFEST_FILENAME),
    join(outputDir, '.laurel-build-stats.json'),
  ];
  const files = [];
  for (const path of candidates) {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      files.push({ path, exists: false });
      continue;
    }
    files.push({ path, exists: true, value: await readJsonOrText(path) });
  }
  return { output_dir: outputDir, files };
}

async function collectLogLines(
  cwd: string,
  outputDir: string,
  count: number,
  env: NodeJS.ProcessEnv,
): Promise<{
  line_count: number;
  sources: Array<{ path: string; exists: boolean; lines?: string[] }>;
}> {
  const candidates = uniqueStrings([
    env.LAUREL_LOG_FILE,
    join(cwd, 'laurel.log'),
    join(cwd, '.laurel', 'laurel.log'),
    join(cwd, '.laurel', 'logs', 'laurel.log'),
    join(cwd, '.laurel', 'logs', 'latest.log'),
    join(outputDir, '.laurel', 'laurel.log'),
    join(outputDir, '.laurel', 'logs', 'laurel.log'),
    join(outputDir, '.laurel', 'logs', 'latest.log'),
  ]);
  const sources: Array<{ path: string; exists: boolean; lines?: string[] }> = [];
  for (const path of candidates) {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      sources.push({ path, exists: false });
      continue;
    }
    const text = await file.text();
    sources.push({
      path,
      exists: true,
      lines: tailLines(text, count).map((line) => redactStringValue(line)),
    });
  }
  return { line_count: count, sources };
}

async function readJsonOrText(path: string): Promise<unknown> {
  const raw = await readFile(path, 'utf8');
  try {
    return redactDiagnosticValue(JSON.parse(raw));
  } catch {
    return redactStringValue(raw);
  }
}

export function redactEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(env).sort()) {
    const value = env[key];
    if (value === undefined) continue;
    out[key] = shouldRedactKey(key) || shouldRedactStringValue(value) ? REDACTED : value;
  }
  return out;
}

export function redactDiagnosticValue(value: unknown, keyPath: readonly string[] = []): unknown {
  const key = keyPath[keyPath.length - 1] ?? '';
  if (shouldRedactKey(key)) return REDACTED;
  if (typeof value === 'string') return redactStringValue(value);
  if (Array.isArray(value)) {
    return value.map((item, index) => redactDiagnosticValue(item, [...keyPath, String(index)]));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      out[childKey] = redactDiagnosticValue(childValue, [...keyPath, childKey]);
    }
    return out;
  }
  return value;
}

function redactStringValue(value: string): string {
  if (shouldRedactStringValue(value)) return REDACTED;
  return value.replace(
    /\b(token|key|secret|password|passwd|pwd|credential|authorization)=([^&\s]+)/gi,
    '$1=[REDACTED]',
  );
}

function shouldRedactKey(key: string): boolean {
  return /TOKEN|KEY|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|PRIVATE|AUTH|SESSION|COOKIE|JWT/i.test(
    key,
  );
}

function shouldRedactStringValue(value: string): boolean {
  if (value.includes('-----BEGIN ') && value.includes(' PRIVATE KEY-----')) return true;
  if (
    /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|xox[abprs]-[A-Za-z0-9-]{16,})\b/.test(
      value,
    )
  ) {
    return true;
  }
  if (/\bAKIA[0-9A-Z]{16}\b/.test(value)) return true;
  if (/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(value)) return true;
  return false;
}

function createTarGz(entries: readonly TarEntry[]): Uint8Array {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const name = normalizeTarPath(entry.path);
    const body = Buffer.from(entry.body);
    chunks.push(createTarHeader(name, body.byteLength, entry.mode ?? 0o600, entry.mtime));
    chunks.push(body);
    const padding = (TAR_BLOCK_SIZE - (body.byteLength % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(TAR_BLOCK_SIZE * 2));
  return gzipSync(Buffer.concat(chunks));
}

function createTarHeader(
  name: string,
  size: number,
  mode: number,
  mtime: Date | undefined,
): Buffer {
  const nameBytes = Buffer.from(name);
  if (nameBytes.byteLength > 100) {
    throw new Error(`diagnostics bundle entry path is too long for ustar: ${name}`);
  }
  const header = Buffer.alloc(TAR_BLOCK_SIZE);
  nameBytes.copy(header, 0);
  writeOctal(header, mode, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, Math.floor((mtime?.getTime() ?? 0) / 1000), 136, 12);
  header.fill(0x20, 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const byte of header) sum += byte;
  writeOctal(header, sum, 148, 8);
  return header;
}

function writeOctal(header: Buffer, value: number, offset: number, length: number): void {
  const text = value
    .toString(8)
    .padStart(length - 1, '0')
    .slice(-(length - 1));
  header.write(text, offset, length - 1, 'ascii');
  header[offset + length - 1] = 0;
}

function normalizeTarPath(path: string): string {
  const normalized = toPosix(path);
  if (normalized.startsWith('/') || normalized.includes('..')) {
    throw new Error(`unsafe diagnostics bundle entry path: ${path}`);
  }
  return normalized;
}

function resolveOutputPath(cwd: string, output: string | undefined, now: Date): string {
  const target = output ?? `laurel-diagnostics-${formatTimestamp(now)}.tar.gz`;
  return isAbsolute(target) ? target : resolve(cwd, target);
}

function parseLogLines(value: string | boolean | undefined): number {
  if (value === undefined || value === false) return DEFAULT_LOG_LINES;
  if (typeof value !== 'string') throw new CliUsageError('--log-lines must be a positive integer');
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) {
    throw new CliUsageError('--log-lines must be an integer from 0 to 10000');
  }
  return parsed;
}

function renderDryRun(result: DiagnosticsBundleResult): string {
  const lines = [`Diagnostics bundle dry run: ${result.output}`, '', 'Entries:'];
  for (const entry of result.entries) lines.push(`  ${entry}`);
  lines.push('');
  return lines.join('\n');
}

function tailLines(text: string, count: number): string[] {
  if (count === 0) return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-count);
}

function resolveProjectPath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function toProjectRel(cwd: string, path: string): string {
  const rel = relative(cwd, path);
  if (!rel || rel === '') return basename(path);
  return toPosix(rel);
}

function toPosix(path: string): string {
  return path.replaceAll('\\', '/');
}

function formatTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[:]/g, '');
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
