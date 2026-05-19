import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
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
    const code = rel.slice(0, rel.length - 5);
    const raw = await readFile(join(dir, rel), 'utf8');
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const strings: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') strings[key] = value;
      }
      out[code] = strings;
    } catch {
      // ignore malformed locale file
    }
  }
  return out;
}
