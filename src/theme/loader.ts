import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import { pathContainsSymlink } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';
import { loadThemeAssets } from './assets.ts';
import { loadThemePackage } from './pkg.ts';
import type { ThemeBundle } from './types.ts';

const LAYOUT_TEMPLATES = new Set([
  'index',
  'home',
  'post',
  'page',
  'tag',
  'author',
  'default',
  'error',
  'error-404',
  'amp',
  'private',
]);

export interface LoadThemeOptions {
  cwd: string;
  config: NectarConfig;
}

export async function loadTheme({ cwd, config }: LoadThemeOptions): Promise<ThemeBundle> {
  const rootDir = join(cwd, config.theme.dir, config.theme.name);
  if (!existsSync(rootDir)) {
    throw new Error(`Theme directory not found: ${rootDir}`);
  }

  const templates: Record<string, string> = {};
  const partials: Record<string, string> = {};

  const glob = new Bun.Glob('**/*.hbs');
  for await (const rel of glob.scan({ cwd: rootDir })) {
    const file = join(rootDir, rel);
    if (pathContainsSymlink(rootDir, rel)) {
      logger.warn(`Skipping symlinked theme template: ${file}`);
      continue;
    }
    const raw = await readFile(file, 'utf8');
    if (rel.startsWith('partials/') || rel.startsWith(`partials${separator()}`)) {
      const name = stripExt(relative(join(rootDir, 'partials'), file));
      partials[normalizeName(name)] = raw;
    } else {
      const name = stripExt(rel);
      templates[normalizeName(name)] = raw;
      if (!LAYOUT_TEMPLATES.has(normalizeName(name))) {
        // Custom layouts (e.g. custom-foo.hbs) and view templates are both kept.
      }
    }
  }

  const pkg = await loadThemePackage(rootDir);
  const locales = await loadLocales(rootDir);
  const assets = await loadThemeAssets(rootDir);

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

function separator(): string {
  return '/';
}

function normalizeName(name: string): string {
  return name.replaceAll('\\', '/');
}

function stripExt(p: string): string {
  return p.slice(0, p.length - extname(p).length);
}

async function loadLocales(rootDir: string): Promise<Record<string, Record<string, string>>> {
  const dir = join(rootDir, 'locales');
  if (!existsSync(dir)) return {};
  const glob = new Bun.Glob('*.json');
  const out: Record<string, Record<string, string>> = {};
  for await (const rel of glob.scan({ cwd: dir })) {
    if (pathContainsSymlink(dir, rel)) {
      logger.warn(`Skipping symlinked locale file: ${join(dir, rel)}`);
      continue;
    }
    const code = rel.slice(0, rel.length - 5);
    const raw = await readFile(join(dir, rel), 'utf8');
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

// Locale strings are rendered by themes through `{{t}}` and frequently through
// `{{{t}}}` (triple-stash) so that translations may contain link markup. That
// makes the locale JSON file an HTML-injection surface: a malicious or
// compromised translation can ship `<script>` or `onerror=` payloads into every
// rendered page. We validate the shape (string keys -> string values), cap the
// length, and reject entries that contain obvious script-injection tokens. We
// still allow benign markup like `<a>` and `<strong>` because real-world Ghost
// locale files rely on it.
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

export function sanitizeLocale(parsed: unknown, fileLabel: string): Record<string, string> {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logger.warn(`Locale file ${fileLabel} must be a JSON object; ignoring.`);
    return {};
  }
  const strings: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      logger.warn(`Locale ${fileLabel}: key ${truncate(key, 64)} has non-string value; skipping.`);
      continue;
    }
    if (key.length > MAX_LOCALE_KEY_LEN) {
      logger.warn(`Locale ${fileLabel}: key exceeds ${MAX_LOCALE_KEY_LEN} chars; skipping.`);
      continue;
    }
    if (value.length > MAX_LOCALE_VALUE_LEN) {
      logger.warn(
        `Locale ${fileLabel}: value for key ${truncate(key, 64)} exceeds ${MAX_LOCALE_VALUE_LEN} chars; skipping.`,
      );
      continue;
    }
    const matched = DANGEROUS_LOCALE_PATTERNS.find((rx) => rx.test(value));
    if (matched) {
      logger.warn(
        `Locale ${fileLabel}: value for key ${truncate(key, 64)} contains dangerous token (${matched.source}); skipping.`,
      );
      continue;
    }
    strings[key] = value;
  }
  return strings;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
