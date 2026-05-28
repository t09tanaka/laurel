import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { loadConfig } from '~/config/loader.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { THEME_SPEC } from '../specs.ts';
import { runThemeLint } from './theme-lint.ts';

const NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export async function runTheme(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(THEME_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(THEME_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(THEME_SPEC));
    return 0;
  }

  const sub = parsed.positionals[0];
  const cwd = process.cwd();
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;

  if (sub === 'new') {
    return runNew({ parsed, cwd, configPath });
  }
  if (sub === 'zip') {
    return runZip({ parsed, cwd, configPath });
  }
  if (sub === 'lint') {
    return runLint({ parsed, cwd });
  }
  if (sub === 'list') {
    return runList({ parsed, cwd, configPath });
  }
  if (sub === 'serve') {
    const { runThemeServe } = await import('./theme-serve.js');
    return runThemeServe({ parsed, cwd, configPath });
  }
  process.stderr.write(
    `Unknown subcommand: ${sub ?? '<missing>'}. Expected \`list\`, \`new <name>\`, \`zip\`, \`lint <path>\`, or \`serve\`.\n`,
  );
  return 2;
}

interface SubOpts {
  parsed: ParsedCommand;
  cwd: string;
  configPath: string | undefined;
}

interface ThemeListRow {
  name: string;
  version: string | null;
  path: string;
  default: boolean;
}

async function runLint({ parsed, cwd }: Omit<SubOpts, 'configPath'>): Promise<number> {
  const target = parsed.positionals[1];
  if (!target) {
    process.stderr.write('`theme lint` requires a <path> argument.\n');
    return 2;
  }
  const themePath = target.startsWith('/') ? target : join(cwd, target);
  const asJson = parsed.values.json === true;
  return runThemeLint({ themePath, asJson });
}

async function runNew({ parsed, cwd, configPath }: SubOpts): Promise<number> {
  const name = parsed.positionals[1];
  if (!name) {
    process.stderr.write('`theme new` requires a <name> argument.\n');
    return 2;
  }
  if (!NAME_RE.test(name)) {
    process.stderr.write(
      `Invalid theme name: ${name}. Expected lowercase alphanumerics + dashes.\n`,
    );
    return 2;
  }
  const fromTheme = typeof parsed.values.from === 'string' ? parsed.values.from : undefined;
  const force = parsed.values.force === true;

  try {
    const config = await loadConfig({ cwd, configPath });
    const themesDir = config.theme.dir;
    const destAbs = join(cwd, themesDir, name);
    if (existsSync(destAbs) && !force) {
      process.stderr.write(`Refusing to overwrite ${destAbs}. Pass --force to overwrite.\n`);
      return 1;
    }
    await mkdir(destAbs, { recursive: true });

    if (fromTheme) {
      const srcAbs = join(cwd, themesDir, fromTheme);
      if (!existsSync(srcAbs)) {
        process.stderr.write(`Source theme not found: ${srcAbs}\n`);
        return 1;
      }
      await copyDir(srcAbs, destAbs);
      logger.info(`Created theme ${name} from ${fromTheme} at ${destAbs}`);
    } else {
      await scaffoldMinimalTheme(destAbs, name);
      logger.info(`Created theme ${name} at ${destAbs}`);
    }
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}

async function runList({ parsed, cwd, configPath }: SubOpts): Promise<number> {
  if (parsed.positionals.length > 1) {
    process.stderr.write('`theme list` takes no further arguments.\n');
    return 2;
  }
  const asJson = parsed.values.json === true;
  try {
    const config = await loadConfig({ cwd, configPath });
    const rows = await listThemes({
      cwd,
      themesDir: config.theme.dir,
      defaultName: config.theme.name,
    });
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ count: rows.length, themes: rows }, null, 2)}\n`);
    } else if (rows.length === 0) {
      process.stdout.write('No themes found.\n');
    } else {
      process.stdout.write(renderThemeListTable(rows));
    }
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}

async function runZip({ parsed, cwd, configPath }: SubOpts): Promise<number> {
  const force = parsed.values.force === true;
  const outputOverride =
    typeof parsed.values.output === 'string' ? parsed.values.output : undefined;
  try {
    const config = await loadConfig({ cwd, configPath });
    const themeName = config.theme.name;
    const themeRoot = join(cwd, config.theme.dir, themeName);
    if (!existsSync(themeRoot)) {
      process.stderr.write(`Theme directory not found: ${themeRoot}\n`);
      return 1;
    }
    const pkg = await readThemePackage(themeRoot);
    if (!pkg) {
      process.stderr.write(
        `Theme has no package.json at ${themeRoot}. gscan requires one with a "name" and "version".\n`,
      );
      return 1;
    }
    if (!pkg.name || !pkg.version) {
      process.stderr.write(
        `Theme package.json must have both "name" and "version" for gscan compatibility.\n`,
      );
      return 1;
    }
    const outAbs = outputOverride
      ? join(cwd, outputOverride)
      : join(cwd, `${pkg.name}-${pkg.version}.zip`);
    if (existsSync(outAbs) && !force) {
      process.stderr.write(`Refusing to overwrite ${outAbs}. Pass --force to overwrite.\n`);
      return 1;
    }
    const entries = await collectThemeFiles(themeRoot);
    const archive = buildZip(entries, themeName);
    await writeFile(outAbs, archive);
    logger.info(`Wrote ${outAbs} (${entries.length} entries, ${archive.byteLength} bytes)`);
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}

async function listThemes(opts: {
  cwd: string;
  themesDir: string;
  defaultName: string;
}): Promise<ThemeListRow[]> {
  const themesRoot = isAbsolute(opts.themesDir) ? opts.themesDir : join(opts.cwd, opts.themesDir);
  if (!existsSync(themesRoot)) return [];
  const entries = await readdir(themesRoot, { withFileTypes: true });
  const rows: ThemeListRow[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const themeRoot = join(themesRoot, entry.name);
    const pkg = await readThemePackage(themeRoot);
    rows.push({
      name: entry.name,
      version: pkg?.version ?? null,
      path: relative(opts.cwd, themeRoot).replaceAll('\\', '/') || entry.name,
      default: entry.name === opts.defaultName,
    });
  }
  rows.sort((a, b) => {
    if (a.default !== b.default) return a.default ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

function renderThemeListTable(rows: ThemeListRow[]): string {
  const nameWidth = Math.max(4, ...rows.map((r) => r.name.length));
  const versionWidth = Math.max(7, ...rows.map((r) => (r.version ?? '-').length));
  const pathWidth = Math.max(4, ...rows.map((r) => r.path.length));
  const lines: string[] = [];
  lines.push(
    `${pad('name', nameWidth)}  ${pad('version', versionWidth)}  ${pad('path', pathWidth)}  default`,
  );
  lines.push(
    `${'-'.repeat(nameWidth)}  ${'-'.repeat(versionWidth)}  ${'-'.repeat(pathWidth)}  -------`,
  );
  for (const row of rows) {
    lines.push(
      `${pad(row.name, nameWidth)}  ${pad(row.version ?? '-', versionWidth)}  ${pad(row.path, pathWidth)}  ${
        row.default ? 'yes' : ''
      }`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function pad(text: string, width: number): string {
  if (text.length >= width) return text;
  return text + ' '.repeat(width - text.length);
}

interface ZipEntry {
  // Path inside the archive (forward slashes).
  archivePath: string;
  data: Buffer;
}

interface ZipSource {
  archivePath: string;
  absPath: string;
}

async function collectThemeFiles(root: string): Promise<ZipSource[]> {
  const out: ZipSource[] = [];
  const skipDirs = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    '.cache',
    '.nectar',
    '.nectar-cache',
    '.DS_Store',
  ]);
  // Pattern test for build artifacts we always want to strip from the bundle.
  const skipFile = (name: string): boolean => {
    if (name === '.DS_Store') return true;
    if (name === 'yarn-error.log') return true;
    if (name.endsWith('.map')) return true; // source maps
    return false;
  };
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        await walk(join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (skipFile(entry.name)) continue;
      const abs = join(current, entry.name);
      const rel = relative(root, abs).replaceAll('\\', '/');
      out.push({ archivePath: rel, absPath: abs });
    }
  }
  await walk(root);
  // Stable order so the archive is reproducible.
  out.sort((a, b) => a.archivePath.localeCompare(b.archivePath));
  return out;
}

interface ThemePackage {
  name?: string;
  version?: string;
}

async function readThemePackage(themeRoot: string): Promise<ThemePackage | null> {
  const pkgPath = join(themeRoot, 'package.json');
  if (!existsSync(pkgPath)) return null;
  const raw = await readFile(pkgPath, 'utf8');
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      version: typeof parsed.version === 'string' ? parsed.version : undefined,
    };
  } catch {
    return null;
  }
}

// Minimal ZIP writer producing a valid archive readable by `unzip`, gscan
// (which itself unpacks with `decompress`), and Ghost's theme uploader. We
// emit a single root directory matching the theme name so the archive
// preserves the on-disk layout when extracted.
export function buildZip(sources: ZipSource[], rootName: string): Buffer {
  return buildZipFromEntries(
    sources.map((s) => ({
      archivePath: s.archivePath,
      data: readFileSyncBuffer(s.absPath),
    })),
    rootName,
  );
}

function readFileSyncBuffer(path: string): Buffer {
  // Sync read is fine here: archive writers naturally serialise entries and
  // streaming would not materially help — node's zlib deflate is sync too.
  return readFileSync(path);
}

// Pure helper exposed for tests; takes entries already in memory.
export function buildZipFromEntries(entries: ZipEntry[], rootName: string): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const archiveName = `${rootName}/${entry.archivePath}`;
    const nameBytes = Buffer.from(archiveName, 'utf8');
    const crc32 = computeCrc32(entry.data);
    const uncompressedSize = entry.data.length;
    let method = 0;
    let compressed: Buffer = entry.data;
    if (uncompressedSize > 0) {
      const deflated = deflateRawSync(entry.data);
      if (deflated.length < uncompressedSize) {
        method = 8;
        compressed = deflated;
      }
    }
    const compressedSize = compressed.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0x0800, 6); // general purpose bit flag (UTF-8 name)
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x0021, 12); // mod date (1980-01-01)
    local.writeUInt32LE(crc32, 14);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    localChunks.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // general purpose bit flag
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc32, 16);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // relative offset of local header
    centralChunks.push(central, nameBytes);

    offset += local.length + nameBytes.length + compressedSize;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const localBlock = Buffer.concat(localChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk where CD starts
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16); // offset of CD
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localBlock, centralDirectory, eocd]);
}

// Lazy CRC32 table. Inlined here so we don't take a dependency on a tiny crc
// module; the math is short.
let CRC32_TABLE: Uint32Array | null = null;
function getCrcTable(): Uint32Array {
  if (CRC32_TABLE) return CRC32_TABLE;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  CRC32_TABLE = table;
  return table;
}

function computeCrc32(data: Buffer): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    const byte = data[i] ?? 0;
    const idx = (crc ^ byte) & 0xff;
    crc = (crc >>> 8) ^ (table[idx] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function copyDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else if (entry.isFile()) {
      await copyFile(from, to);
    }
  }
}

async function scaffoldMinimalTheme(destAbs: string, themeName: string): Promise<void> {
  await mkdir(join(destAbs, 'partials'), { recursive: true });
  await mkdir(join(destAbs, 'assets/css'), { recursive: true });
  await mkdir(join(destAbs, 'locales'), { recursive: true });

  const pkg = {
    name: themeName,
    description: `Nectar theme ${themeName}`,
    version: '0.1.0',
    engines: { ghost: '>=5.0.0' },
    license: 'MIT',
    keywords: ['ghost-theme'],
    config: { posts_per_page: 5 },
  };
  await writeFile(join(destAbs, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

  await writeFile(
    join(destAbs, 'default.hbs'),
    [
      '<!DOCTYPE html>',
      '<html lang="{{lang}}">',
      '<head>',
      '  <meta charset="utf-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
      '  <title>{{meta_title}}</title>',
      '  <meta name="description" content="{{meta_description}}" />',
      '  {{ghost_head}}',
      '</head>',
      '<body class="{{body_class}}">',
      '  <main>{{{body}}}</main>',
      '  {{ghost_foot}}',
      '</body>',
      '</html>',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(destAbs, 'index.hbs'),
    [
      '{{!< default}}',
      '<header><h1>{{@site.title}}</h1></header>',
      '{{#foreach posts}}',
      '  <article>',
      '    <h2><a href="{{url}}">{{title}}</a></h2>',
      '    {{excerpt}}',
      '  </article>',
      '{{/foreach}}',
      '{{pagination}}',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(destAbs, 'post.hbs'),
    [
      '{{!< default}}',
      '<article class="{{post_class}}">',
      '  <h1>{{title}}</h1>',
      '  {{content}}',
      '</article>',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(destAbs, 'page.hbs'),
    [
      '{{!< default}}',
      '<article class="{{post_class}}">',
      '  <h1>{{title}}</h1>',
      '  {{content}}',
      '</article>',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(join(destAbs, 'assets/css/screen.css'), '/* theme styles */\n', 'utf8');
  await writeFile(join(destAbs, 'locales/en.json'), '{}\n', 'utf8');
  await writeFile(
    join(destAbs, 'README.md'),
    `# ${themeName}\n\nA Nectar theme scaffolded with \`nectar theme new ${themeName}\`.\n`,
    'utf8',
  );
}
