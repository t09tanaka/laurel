import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { loadConfig } from '~/config/loader.ts';
import type { NectarConfig } from '~/config/schema.ts';
import { resolveThemeRoot } from '~/theme/loader.ts';
import { loadThemePackage } from '~/theme/pkg.ts';
import { ensureDir } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';
import { t } from '../i18n/index.ts';
import { writeGeneratedTextFile } from '../line-endings.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { isValidCliSlug, slugifyCliValue } from '../slug.ts';
import { NEW_SPEC } from '../specs.ts';

type BuiltInKind = 'post' | 'page' | 'tag' | 'author';
type KindModel = BuiltInKind | 'custom';

interface NewKindDefinition {
  kind: string;
  dir: string;
  model: KindModel;
  titleField: string;
}

export async function runNew(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(NEW_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(NEW_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(NEW_SPEC));
    return 0;
  }

  const [kindArg, ...rest] = parsed.positionals;
  if (!kindArg) {
    process.stderr.write(
      `${t('new.invalidKind', { kind: '<missing>', kinds: 'post, page, tag, author' })}\n\n`,
    );
    process.stderr.write(formatCommandHelp(NEW_SPEC));
    return 2;
  }

  const draft = parsed.values.draft === true;
  const dateRaw = typeof parsed.values.date === 'string' ? parsed.values.date.trim() : '';
  const tagsRaw = typeof parsed.values.tags === 'string' ? parsed.values.tags : '';
  const authorRaw = typeof parsed.values.author === 'string' ? parsed.values.author.trim() : '';
  const openEditor = parsed.values.open === true;
  const force = parsed.values.force === true;
  const slugOverrideRaw = typeof parsed.values.slug === 'string' ? parsed.values.slug.trim() : '';

  const cwd = process.cwd();
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    config = await loadConfig({ cwd, configPath });
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }

  const kinds = await resolveNewKinds(cwd, config);
  const kindDef = kinds.get(kindArg);
  if (!kindDef) {
    process.stderr.write(
      `${t('new.invalidKind', { kind: kindArg, kinds: Array.from(kinds.keys()).join(', ') })}\n\n`,
    );
    process.stderr.write(formatCommandHelp(NEW_SPEC));
    return 2;
  }

  const kind = kindDef.kind;
  const remainder = rest.join(' ').trim();
  if (!remainder) {
    if (usesTitle(kindDef)) {
      process.stderr.write(`${t('new.emptyTitle')}\n\n`);
    } else {
      process.stderr.write(`${t('new.requiredValue', { label: 'slug' })}\n\n`);
    }
    process.stderr.write(formatCommandHelp(NEW_SPEC));
    return 2;
  }

  const isPost = kindDef.model === 'post';
  const isPostOrPage = isPost || kindDef.model === 'page';
  const isPostPageOrCustom = isPostOrPage || kindDef.model === 'custom';

  if (!isPost && (dateRaw || tagsRaw || authorRaw)) {
    process.stderr.write(`${t('new.optionPostOnly')}\n\n`);
    process.stderr.write(formatCommandHelp(NEW_SPEC));
    return 2;
  }
  if (!isPostOrPage && draft) {
    process.stderr.write(`${t('new.optionDraftKind')}\n\n`);
    process.stderr.write(formatCommandHelp(NEW_SPEC));
    return 2;
  }
  if (!isPostPageOrCustom && slugOverrideRaw) {
    process.stderr.write(`${t('new.optionSlugKind')}\n\n`);
    process.stderr.write(formatCommandHelp(NEW_SPEC));
    return 2;
  }

  let isoDate: string | undefined;
  if (dateRaw) {
    const parsedDate = new Date(dateRaw);
    if (Number.isNaN(parsedDate.getTime())) {
      process.stderr.write(`${t('new.invalidDate', { value: dateRaw })}\n`);
      return 2;
    }
    isoDate = parsedDate.toISOString();
  }

  if (slugOverrideRaw && !isValidCliSlug(slugOverrideRaw)) {
    process.stderr.write(
      `${t('new.invalidSlugValue', { label: '--slug', value: slugOverrideRaw })}\n`,
    );
    return 2;
  }

  const slug = isPostPageOrCustom && slugOverrideRaw ? slugOverrideRaw : slugifyCliValue(remainder);
  if (!isValidCliSlug(slug)) {
    process.stderr.write(`${t('new.invalidSlug')}\n`);
    return 2;
  }

  const baseDir = kindDef.dir;
  const dest = isAbsolute(baseDir) ? join(baseDir, `${slug}.md`) : join(cwd, baseDir, `${slug}.md`);
  await ensureDir(dirname(dest));

  if (!force && (await fileExists(dest))) {
    process.stderr.write(`${t('new.refuseOverwrite', { path: dest })}\n`);
    return 1;
  }

  const tagList = parseCsvList(tagsRaw);
  const body = renderFrontmatter({
    kind: kindDef,
    title: usesTitle(kindDef) ? remainder : titleFromSlug(slug),
    slug,
    date: isPost ? (isoDate ?? new Date().toISOString()) : undefined,
    draft: isPostOrPage ? draft : false,
    tags: tagList,
    author: authorRaw,
  });

  await writeGeneratedTextFile(dest, body);

  const asJson = parsed.values.json === true;
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ ok: true, kind, slug, path: dest })}\n`);
  } else {
    logger.info(t('new.created', { path: dest }));
  }

  if (openEditor) {
    const code = await openInEditor(dest);
    if (code !== 0) return code;
  }

  return 0;
}

async function resolveNewKinds(
  cwd: string,
  config: NectarConfig,
): Promise<Map<string, NewKindDefinition>> {
  const kinds = new Map<string, NewKindDefinition>();
  addKind(kinds, {
    kind: 'post',
    dir: config.content.posts_dir,
    model: 'post',
    titleField: 'title',
  });
  addKind(kinds, {
    kind: 'page',
    dir: config.content.pages_dir,
    model: 'page',
    titleField: 'title',
  });
  addKind(kinds, { kind: 'tag', dir: config.content.tags_dir, model: 'tag', titleField: 'name' });
  addKind(kinds, {
    kind: 'author',
    dir: config.content.authors_dir,
    model: 'author',
    titleField: 'name',
  });

  const themeKinds = await loadThemeNewKinds(cwd, config);
  for (const [kind, def] of Object.entries(themeKinds)) {
    addKind(kinds, { kind, dir: def.dir, model: 'custom', titleField: def.title_field });
  }
  for (const [kind, def] of Object.entries(config.content.kinds)) {
    addKind(kinds, { kind, dir: def.dir, model: 'custom', titleField: def.title_field });
  }
  return kinds;
}

async function loadThemeNewKinds(
  cwd: string,
  config: NectarConfig,
): Promise<Record<string, { dir: string; title_field: string }>> {
  const rootDir = resolveThemeRoot(cwd, config.theme.dir, config.theme.name);
  if (!existsSync(rootDir)) return {};
  const pkg = await loadThemePackage(rootDir);
  return pkg.content_kinds ?? {};
}

function addKind(kinds: Map<string, NewKindDefinition>, def: NewKindDefinition): void {
  const normalized = def.kind.trim().toLowerCase();
  if (!isContentKindName(normalized)) return;
  kinds.set(normalized, { ...def, kind: normalized });
}

function isContentKindName(value: string): boolean {
  return /^[a-z][a-z0-9_-]*$/.test(value);
}

function usesTitle(kind: NewKindDefinition): boolean {
  return kind.model === 'post' || kind.model === 'page' || kind.model === 'custom';
}

interface FrontmatterInput {
  kind: NewKindDefinition;
  title: string;
  slug: string;
  date?: string | undefined;
  draft: boolean;
  tags: string[];
  author: string;
}

function renderFrontmatter(input: FrontmatterInput): string {
  const { kind, title, slug, date, draft, tags, author } = input;
  const lines: string[] = ['---'];

  if (kind.model === 'post' || kind.model === 'page') {
    lines.push(`title: ${JSON.stringify(title)}`);
    lines.push(`slug: ${slug}`);
    if (date) lines.push(`date: ${date}`);
    if (draft) lines.push('status: draft');
    if (kind.model === 'post') {
      lines.push(`tags: ${formatYamlSlugList(tags)}`);
      lines.push(`authors: ${formatYamlSlugList(author ? [author] : [])}`);
    }
  } else if (kind.model === 'tag' || kind.model === 'author') {
    lines.push(`slug: ${slug}`);
    lines.push(`name: ${JSON.stringify(title)}`);
    if (kind.model === 'tag') {
      lines.push('description: ""');
    } else {
      lines.push('bio: ""');
    }
  } else {
    lines.push(`slug: ${slug}`);
    lines.push(`${kind.titleField}: ${JSON.stringify(title)}`);
  }

  lines.push('---', '');
  if (kind.model === 'post' || kind.model === 'page') {
    lines.push(`# ${title}`, '', 'Write your content here.', '');
  } else {
    const noun = kind.kind;
    lines.push(`Describe this ${noun} here.`, '');
  }
  return lines.join('\n');
}

function formatYamlSlugList(items: string[]): string {
  if (items.length === 0) return '[]';
  return `[${items.map((s) => JSON.stringify(s)).join(', ')}]`;
}

function parseCsvList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => slugifyCliValue(s))
    .filter((s) => s.length > 0);
}

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function openInEditor(path: string): Promise<number> {
  const editor = process.env.VISUAL || process.env.EDITOR;
  if (!editor) {
    process.stderr.write(`${t('new.warnEditorMissing', { path })}\n`);
    return 0;
  }
  const proc = Bun.spawn([editor, path], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) {
    process.stderr.write(`${t('new.editorExited', { editor, code })}\n`);
  }
  return code;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
