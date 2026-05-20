import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import { NectarError } from '~/util/errors.ts';
import { pathContainsSymlink, scanGlob } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';
import { loadThemeAssets } from './assets.ts';
import { loadThemePackage } from './pkg.ts';
import type { ThemeBundle, ThemeLocale, ThemeLocaleMap } from './types.ts';

export interface LoadThemeOptions {
  cwd: string;
  config: NectarConfig;
}

export async function loadTheme({ cwd, config }: LoadThemeOptions): Promise<ThemeBundle> {
  const rootDir = resolveThemeRoot(cwd, config.theme.dir, config.theme.name);
  if (!existsSync(rootDir)) {
    throw new NectarError({
      message: `Theme directory not found: ${rootDir}`,
      hint: 'Set [theme].dir to the directory holding the theme (or to an npm package name like `@scope/nectar-theme-foo` resolvable via `node_modules/<spec>`).',
      code: 'theme',
    });
  }

  const templates: Record<string, string> = {};
  const partials: Record<string, string> = {};

  // Collect every `.hbs` path up front so the per-file `readFile` fan-out can
  // start immediately under `Promise.all`. Streaming the glob entry-by-entry
  // would serialise the I/O behind scan progress for no gain — Bun's glob is
  // sequential either way, and themes routinely ship 100+ partials.
  const allRels = await scanGlob('**/*.hbs', { cwd: rootDir });
  const relPaths = allRels.filter((rel) => {
    if (pathContainsSymlink(rootDir, rel)) {
      logger.warn(`Skipping symlinked theme template: ${join(rootDir, rel)}`);
      return false;
    }
    return true;
  });

  const sources = await Promise.all(relPaths.map((rel) => readFile(join(rootDir, rel), 'utf8')));

  for (let i = 0; i < relPaths.length; i++) {
    const rel = relPaths[i];
    const raw = sources[i];
    if (rel === undefined || raw === undefined) continue;
    if (rel.startsWith('partials/') || rel.startsWith(`partials${separator()}`)) {
      const name = stripExt(relative(join(rootDir, 'partials'), join(rootDir, rel)));
      partials[normalizeName(name)] = raw;
    } else {
      const name = stripExt(rel);
      templates[normalizeName(name)] = raw;
    }
  }

  const pkg = await loadThemePackage(rootDir);
  const locales = await loadLocales(rootDir);
  const assets = await loadThemeAssets(rootDir, { cacheDir: join(cwd, '.nectar-cache') });

  return {
    name: config.theme.name,
    rootDir,
    templates,
    partials,
    pkg,
    locales,
    assets,
  };
}

// Resolve where the theme's files live, allowing three input shapes:
//   1. Local relative directory: `themes` -> `<cwd>/themes/<name>/`. Pre-#853
//      behaviour; still the default for the example site.
//   2. Local absolute directory: `/abs/path/themes` -> `/abs/path/themes/<name>/`.
//      The config loader rewrites relative `theme.dir` values to absolute
//      paths anchored at the config file's directory, so this branch is hit
//      whenever the config was loaded via `--config <path>` (#853).
//   3. npm package spec: `@scope/nectar-theme-foo` or `nectar-theme-foo` ->
//      `<cwd>/node_modules/<spec>/`. Falls back to this branch only when the
//      local-directory resolution didn't find anything on disk, so the
//      pre-existing `theme.dir = "themes"` default keeps working even though
//      a bare `themes` string also matches the npm package regex (#855).
export function resolveThemeRoot(cwd: string, themeDir: string, themeName: string): string {
  if (isAbsolute(themeDir)) {
    return join(themeDir, themeName);
  }
  const localRoot = join(cwd, themeDir, themeName);
  if (existsSync(localRoot)) return localRoot;
  if (looksLikeNpmPackage(themeDir)) {
    const pkgRoot = resolve(cwd, 'node_modules', themeDir);
    // If the package itself ships a `package.json` at the root, treat the
    // package as the theme directly (single-theme packages); otherwise fall
    // back to the `<root>/<themeName>/` convention so a package can host
    // multiple themes under different subdirectories.
    if (existsSync(pkgRoot)) {
      if (existsSync(join(pkgRoot, 'package.json'))) return pkgRoot;
      return join(pkgRoot, themeName);
    }
  }
  // Nothing on disk; return the local-root path so the not-found error
  // message points at the canonical location the user would expect.
  return localRoot;
}

// Cheap heuristic: an npm package spec is either `@scope/name` or `name`
// where `name` is a valid npm package identifier (lowercase letters, digits,
// `-`, `_`, `.`). Local paths almost always include `/` or `\`, start with
// `./` / `../`, or are an empty string, so the regex tolerates a single
// optional `@scope/` prefix followed by exactly one path segment.
function looksLikeNpmPackage(themeDir: string): boolean {
  if (themeDir.length === 0) return false;
  if (themeDir.startsWith('.') || themeDir.includes('\\')) return false;
  if (themeDir.includes('/')) {
    return /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(themeDir);
  }
  return /^[a-z0-9][a-z0-9._-]*$/.test(themeDir);
}

function separator(): string {
  return '/';
}

function normalizeName(name: string): string {
  return name.replaceAll('\\', '/');
}

function stripExt(p: string): string {
  return p.slice(0, p.length - extname(p).length);
}

async function loadLocales(rootDir: string): Promise<ThemeLocaleMap> {
  const dir = join(rootDir, 'locales');
  if (!existsSync(dir)) return {};
  const allRels = await scanGlob('*.json', { cwd: dir });
  const rels = allRels.filter((rel) => {
    if (pathContainsSymlink(dir, rel)) {
      logger.warn(`Skipping symlinked locale file: ${join(dir, rel)}`);
      return false;
    }
    return true;
  });
  // Read every locale JSON in parallel; the typical theme ships a few dozen
  // tiny files, so the readFile fan-out keeps the load phase a single tick of
  // I/O instead of one round-trip per locale.
  const raws = await Promise.all(rels.map((rel) => readFile(join(dir, rel), 'utf8')));
  const out: ThemeLocaleMap = {};
  for (let i = 0; i < rels.length; i += 1) {
    const rel = rels[i];
    const raw = raws[i];
    if (rel === undefined || raw === undefined) continue;
    const code = rel.slice(0, rel.length - 5);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn(`Locale file ${rel} is not valid JSON; ignoring.`);
      continue;
    }
    out[code] = sanitizeLocale(parsed, rel);
  }
  return out;
}

// Locale values are rendered by themes through `{{t}}` and frequently through
// `{{{t}}}` (triple-stash) so that translations may contain link markup. That
// makes the locale JSON file an HTML-injection surface: a malicious or
// compromised translation can ship `<script>` or `onerror=` payloads into every
// rendered page. We validate the shape (string keys -> string/number/boolean
// values), cap the rendered length, and reject entries that contain obvious
// script-injection tokens. We still allow benign markup like `<a>` and
// `<strong>` because real-world Ghost locale files rely on it.
const MAX_LOCALE_KEY_LEN = 256;
const MAX_LOCALE_VALUE_LEN = 4096;
const DANGEROUS_LOCALE_PATTERNS: ReadonlyArray<RegExp> = [
  /<script\b/i,
  /<\/script\b/i,
  /<iframe\b/i,
  /<object\b/i,
  /<embed\b/i,
  /<svg\b/i,
  /<link\b/i,
  /<meta\b/i,
  /\bjavascript:/i,
  /\bdata:text\/html/i,
  /\son[a-z]+\s*=/i,
];

export function sanitizeLocale(parsed: unknown, fileLabel: string): ThemeLocale {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logger.warn(`Locale file ${fileLabel} must be a JSON object; ignoring.`);
    return {};
  }
  const entries: ThemeLocale = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isLocaleValue(value)) {
      logger.warn(
        `Locale ${fileLabel}: key ${truncate(key, 64)} has unsupported value type; skipping.`,
      );
      continue;
    }
    if (key.length > MAX_LOCALE_KEY_LEN) {
      logger.warn(`Locale ${fileLabel}: key exceeds ${MAX_LOCALE_KEY_LEN} chars; skipping.`);
      continue;
    }
    const renderedValue = String(value);
    if (renderedValue.length > MAX_LOCALE_VALUE_LEN) {
      logger.warn(
        `Locale ${fileLabel}: value for key ${truncate(key, 64)} exceeds ${MAX_LOCALE_VALUE_LEN} chars; skipping.`,
      );
      continue;
    }
    const matched = DANGEROUS_LOCALE_PATTERNS.find((rx) => rx.test(renderedValue));
    if (matched) {
      logger.warn(
        `Locale ${fileLabel}: value for key ${truncate(key, 64)} contains dangerous token (${matched.source}); skipping.`,
      );
      continue;
    }
    entries[key] = value;
  }
  return entries;
}

function isLocaleValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
