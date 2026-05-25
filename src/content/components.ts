import { readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import { pathContainsSymlink, scanGlob } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';
import { parseFrontmatter } from './frontmatter.ts';
import type { ComponentSnippet, ContentSourceFingerprint } from './model.ts';

// Components are reusable HTML+CSS snippets keyed by slug. They live as
// markdown files (`content/components/<slug>.md`) with frontmatter for
// metadata and two fenced code blocks (```css and ```html) carrying the
// payloads.
//
// The slug determines the shortcode that expands into the HTML, so it must
// be a well-formed identifier — letters first, then letters / digits /
// underscore / dash. Anything else is rejected at load time with a warning
// rather than at render time when the failure mode is obscure.
export const COMPONENT_SLUG_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

function isFsErrnoCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === code
  );
}

interface FencedBlocks {
  css: string;
  html: string;
}

// Permissive fenced-code-block matcher. We accept any number of backticks
// (>=3), an optional info string, then the body up to the matching close
// fence. `\1` ties the close fence length to the open fence so a `~~~`
// inside a `` ``` `` block doesn't terminate early.
const FENCE_PATTERN = /^(`{3,}|~{3,})[ \t]*([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)\r?\n?\1[ \t]*$/gm;

function extractFencedBlocks(body: string): FencedBlocks {
  const blocks: FencedBlocks = { css: '', html: '' };
  for (const match of body.matchAll(FENCE_PATTERN)) {
    const lang = (match[2] ?? '').toLowerCase();
    const content = match[3] ?? '';
    if (lang === 'css' && !blocks.css) blocks.css = content;
    else if (lang === 'html' && !blocks.html) blocks.html = content;
  }
  return blocks;
}

function slugFromFilename(file: string): string {
  return basename(file, '.md');
}

function asString(value: unknown, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

async function loadComponentFile(
  cwd: string,
  rel: string,
  componentsDir: string,
): Promise<ComponentSnippet | null> {
  const absolute = join(componentsDir, rel);
  let raw: string;
  let stats: { mtimeMs: number; size: number };
  try {
    raw = await readFile(absolute, 'utf8');
    const s = await stat(absolute);
    stats = { mtimeMs: s.mtimeMs, size: s.size };
  } catch (err) {
    logger.warn(
      `loadComponents: failed to read ${absolute}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  let parsed: ReturnType<typeof parseFrontmatter>;
  try {
    parsed = parseFrontmatter(raw, { filePath: absolute });
  } catch (err) {
    logger.warn(
      `loadComponents: invalid frontmatter in ${absolute}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  const fm = parsed.data;
  const slug = asString(fm.slug, slugFromFilename(rel)).trim();
  if (!COMPONENT_SLUG_PATTERN.test(slug)) {
    logger.warn(
      `loadComponents: skipping ${absolute} — slug "${slug}" must match ${COMPONENT_SLUG_PATTERN.source}`,
    );
    return null;
  }
  const { css, html } = extractFencedBlocks(parsed.body);
  if (!html) {
    logger.warn(`loadComponents: skipping ${absolute} — missing required \`\`\`html block`);
    return null;
  }
  const source: ContentSourceFingerprint = {
    path: absolute.startsWith(cwd) ? absolute.slice(cwd.length).replace(/^[/\\]/, '') : absolute,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
  return {
    slug,
    description: asString(fm.description).trim(),
    css: css.trim(),
    html: html.trim(),
    source,
  };
}

export async function loadComponents(
  cwd: string,
  config: NectarConfig,
): Promise<ComponentSnippet[]> {
  const componentsDir = resolve(cwd, config.content.components_dir);
  let rels: string[];
  try {
    rels = await scanGlob('**/*.md', { cwd: componentsDir });
  } catch (err) {
    if (!isFsErrnoCode(err, 'ENOENT')) {
      logger.warn(
        `loadComponents: failed to scan ${componentsDir}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return [];
  }
  const filtered = rels.filter((rel) => !pathContainsSymlink(componentsDir, rel));
  const loaded = await Promise.all(
    filtered.map((rel) => loadComponentFile(cwd, rel, componentsDir)),
  );
  const components: ComponentSnippet[] = [];
  const seen = new Map<string, string>();
  for (const c of loaded) {
    if (!c) continue;
    const prev = seen.get(c.slug);
    if (prev) {
      logger.warn(
        `loadComponents: duplicate slug "${c.slug}" — keeping ${prev}, ignoring ${c.source.path}`,
      );
      continue;
    }
    seen.set(c.slug, c.source.path);
    components.push(c);
  }
  components.sort((a, b) => a.slug.localeCompare(b.slug));
  return components;
}
