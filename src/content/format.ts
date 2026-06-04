import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import yaml from 'js-yaml';
import type { LaurelConfig } from '~/config/schema.ts';
import { scanGlob } from '~/util/fs.ts';
import { parseFrontmatter } from './frontmatter.ts';

interface FormatContentOptions {
  cwd: string;
  config: LaurelConfig;
  check?: boolean;
}

interface FormatContentResult {
  checked: boolean;
  changed: string[];
  scanned: number;
}

const DATE_KEYS = new Set(['date', 'published_at', 'updated_at', 'created_at']);
const TAG_KEYS = new Set(['tags']);

export async function formatContent(opts: FormatContentOptions): Promise<FormatContentResult> {
  const files = await listContentMarkdown(opts.cwd, opts.config);
  const changed: string[] = [];

  for (const file of files) {
    const original = await readFile(file, 'utf8');
    const formatted = formatContentSource(original, { filePath: file });
    if (formatted === original) continue;

    changed.push(relative(opts.cwd, file));
    if (opts.check !== true) {
      await writeFile(file, formatted, 'utf8');
    }
  }

  return { checked: opts.check === true, changed, scanned: files.length };
}

export function formatContentSource(raw: string, options: { filePath?: string } = {}): string {
  const hasFrontmatter = hasYamlFrontmatter(raw);
  if (!hasFrontmatter) return ensureTrailingNewline(raw);

  const parsed = parseFrontmatter(raw, options);
  const data = normalizeFrontmatter(parsed.data);
  const frontmatter = yaml
    .dump(data, {
      lineWidth: -1,
      noRefs: true,
      schema: yaml.FAILSAFE_SCHEMA,
      sortKeys: true,
    })
    .trimEnd();

  return ensureTrailingNewline(`---\n${frontmatter}\n---\n${parsed.body}`);
}

async function listContentMarkdown(cwd: string, config: LaurelConfig): Promise<string[]> {
  const dirs = [
    config.content.posts_dir,
    config.content.pages_dir,
    config.content.tags_dir,
    config.content.authors_dir,
  ];
  const uniqueDirs = [...new Set(dirs.map((dir) => absolutise(cwd, dir)))];
  const lists = await Promise.all(
    uniqueDirs.map(async (dir) => {
      try {
        const rels = await scanGlob('**/*.md', { cwd: dir });
        return rels.map((rel) => join(dir, rel));
      } catch {
        return [];
      }
    }),
  );
  return lists.flat().sort();
}

function normalizeFrontmatter(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (DATE_KEYS.has(key)) {
      out[key] = normalizeDate(value);
    } else if (TAG_KEYS.has(key)) {
      out[key] = normalizeTags(value);
    } else if (key === 'primary_tag') {
      out[key] = normalizeSlug(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function normalizeDate(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return value;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

function normalizeTags(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSlug(item));
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => normalizeSlug(item))
      .filter((item) => typeof item === 'string' && item.length > 0);
  }
  return value;
}

function normalizeSlug(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

function hasYamlFrontmatter(raw: string): boolean {
  const firstNewline = raw.indexOf('\n');
  const firstLine = firstNewline === -1 ? raw : raw.slice(0, firstNewline);
  return firstLine.trim() === '---' || /^---ya?ml\s*$/i.test(firstLine.trim());
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function absolutise(cwd: string, dir: string): string {
  return isAbsolute(dir) ? resolve(dir) : resolve(cwd, dir);
}
