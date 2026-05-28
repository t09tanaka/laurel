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

export const THEME_MEMBERS_REQUIRED_WITHOUT_PORTAL_WARNING =
  'Theme package.json declares config.members = "required", but [components.portal].provider is "none". Configure a Portal provider before building this theme.';
const GHOST_COMPAT_MAJOR = 5;
export const THEME_EMAIL_TEMPLATE_NAMES = ['email', 'email-template'] as const;

export async function loadTheme({ cwd, config }: LoadThemeOptions): Promise<ThemeBundle> {
  const rootDir = resolveThemeRoot(cwd, config.theme.dir, config.theme.name);
  if (!existsSync(rootDir)) {
    const relRoot = relative(cwd, rootDir);
    const cloneTarget = relRoot && !relRoot.startsWith('..') ? relRoot : rootDir;
    throw new NectarError({
      message: `Theme directory not found: ${rootDir}`,
      hint: `Vendor a Ghost theme into this directory before building. For the default Source theme, run:\n  git clone https://github.com/TryGhost/Source ${cloneTarget}\nOther Ghost-compatible themes (Casper, Headline, Edition, Wave, Liebling, …) follow the same pattern — clone the repository into the directory shown above. Or set [theme].dir to a directory holding the theme (or to an npm package name like \`@scope/nectar-theme-foo\` resolvable via \`node_modules/<spec>\`).`,
      code: 'theme',
    });
  }

  const templates: Record<string, string> = {};
  const emailTemplates: Record<string, string> = {};
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
      const normalizedName = normalizeName(name);
      if (isEmailTemplateName(normalizedName)) {
        emailTemplates[normalizedName] = raw;
      } else {
        templates[normalizedName] = raw;
      }
    }
  }

  const pkg = await loadThemePackage(rootDir);
  warnIfMembersRequiredWithoutPortal(pkg, config);
  warnIfGhostEngineUnsupported(pkg);
  const locales = await loadLocales(rootDir, [
    join(cwd, 'content', 'translations'),
    join(cwd, 'content', 'themes', config.theme.name, 'locales'),
  ]);
  const assets = await loadThemeAssets(rootDir, { cacheDir: join(cwd, '.nectar/cache') });

  return {
    name: config.theme.name,
    rootDir,
    templates,
    emailTemplates,
    partials,
    pkg,
    locales,
    assets,
  };
}

function isEmailTemplateName(name: string): boolean {
  return (THEME_EMAIL_TEMPLATE_NAMES as readonly string[]).includes(name);
}

function warnIfMembersRequiredWithoutPortal(pkg: ThemeBundle['pkg'], config: NectarConfig): void {
  if (pkg.members !== 'required') return;
  if (config.components.portal.provider !== 'none') return;
  logger.warn(THEME_MEMBERS_REQUIRED_WITHOUT_PORTAL_WARNING);
}

function warnIfGhostEngineUnsupported(pkg: ThemeBundle['pkg']): void {
  const range = pkg.engines?.ghost;
  if (!range) return;
  if (ghostEngineAllowsMajor(range, GHOST_COMPAT_MAJOR)) return;
  logger.warn(
    `Theme package.json declares engines.ghost = "${range}", which does not include Ghost ${GHOST_COMPAT_MAJOR}.x; Nectar targets Ghost ${GHOST_COMPAT_MAJOR} theme compatibility.`,
  );
}

function ghostEngineAllowsMajor(range: string, major: number): boolean {
  const clauses = range
    .split('||')
    .map((clause) => clause.trim())
    .filter(Boolean);
  if (clauses.length === 0) return true;
  return clauses.some((clause) => ghostEngineClauseAllowsMajor(clause, major));
}

function ghostEngineClauseAllowsMajor(clause: string, major: number): boolean {
  const normalized = clause.replaceAll(/\s+-\s+/g, ' ');
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return candidateGhostVersions(major).some((candidate) =>
    tokens.every((token) => ghostEngineTokenAllowsVersion(token, candidate)),
  );
}

function candidateGhostVersions(major: number): Array<[number, number, number]> {
  return [
    [major, 0, 0],
    [major, 1, 0],
    [major, 999, 999],
  ];
}

function ghostEngineTokenAllowsVersion(token: string, version: [number, number, number]): boolean {
  if (token === '*' || /^x$/i.test(token)) return true;
  const caret = token.match(/^\^(.+)$/);
  if (caret) {
    const parsed = parseGhostVersion(caret[1] ?? '');
    return parsed ? version[0] === parsed[0] && compareVersions(version, parsed) >= 0 : true;
  }
  const tilde = token.match(/^~(.+)$/);
  if (tilde) {
    const parsed = parseGhostVersion(tilde[1] ?? '');
    return parsed ? version[0] === parsed[0] && compareVersions(version, parsed) >= 0 : true;
  }
  const comparator = token.match(/^(<=|>=|<|>|=)?(.+)$/);
  if (!comparator) return true;
  const op = comparator[1] ?? '=';
  const raw = comparator[2] ?? '';
  if (/^[x*]$/i.test(raw) || /^[x*]\./i.test(raw)) return true;
  if (/^\d+\.x$/i.test(raw) || /^\d+$/.test(raw)) {
    const parsedMajor = Number.parseInt(raw, 10);
    if (op === '=') return version[0] === parsedMajor;
  }
  const parsed = parseGhostVersion(raw);
  if (!parsed) return true;
  const cmp = compareVersions(version, parsed);
  switch (op) {
    case '<':
      return cmp < 0;
    case '<=':
      return cmp <= 0;
    case '>':
      return cmp > 0;
    case '>=':
      return cmp >= 0;
    default:
      return cmp === 0;
  }
}

function parseGhostVersion(raw: string): [number, number, number] | undefined {
  const match = raw.match(/^(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/i);
  if (!match) return undefined;
  return [
    Number.parseInt(match[1] ?? '0', 10),
    parseVersionPart(match[2]),
    parseVersionPart(match[3]),
  ];
}

function parseVersionPart(raw: string | undefined): number {
  if (!raw || raw === 'x' || raw === 'X' || raw === '*') return 0;
  return Number.parseInt(raw, 10);
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
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

async function loadLocales(
  rootDir: string,
  overrideDirs: readonly string[] = [],
): Promise<ThemeLocaleMap> {
  const themeLocales = await loadLocaleDir(join(rootDir, 'locales'));
  for (const dir of overrideDirs) {
    const overrides = await loadLocaleDir(dir);
    for (const [code, locale] of Object.entries(overrides)) {
      themeLocales[code] = { ...(themeLocales[code] ?? {}), ...locale };
    }
  }
  return themeLocales;
}

async function loadLocaleDir(dir: string): Promise<ThemeLocaleMap> {
  if (!existsSync(dir)) return {};
  const allRels = await scanGlob('*.json', { cwd: dir });
  const rels = allRels.filter((rel) => {
    if (pathContainsSymlink(dir, rel)) {
      logger.warn(`Skipping symlinked locale file: ${join(dir, rel)}`);
      return false;
    }
    const code = stripExt(rel);
    if (!isThemeLocaleFilename(code)) return false;
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Locale file ${join(dir, rel)} is not valid JSON; ignoring. ${message}`);
      continue;
    }
    out[code] = sanitizeLocale(parsed, rel);
  }
  return out;
}

function isThemeLocaleFilename(code: string): boolean {
  return /^[a-zA-Z]{2,3}(?:[-_][a-zA-Z0-9]{2,8})*$/.test(code);
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
