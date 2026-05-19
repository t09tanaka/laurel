import { access, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import slugify from 'slugify';
import { loadConfig } from '~/config/loader.ts';
import { ensureDir } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { NEW_SPEC } from '../specs.ts';

type Kind = 'post' | 'page' | 'tag' | 'author';
const VALID_KINDS: readonly Kind[] = ['post', 'page', 'tag', 'author'];

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
  if (!kindArg || !VALID_KINDS.includes(kindArg as Kind)) {
    process.stderr.write(
      `Invalid kind: ${kindArg ?? '<missing>'}. Expected one of: ${VALID_KINDS.join(', ')}.\n\n`,
    );
    process.stderr.write(formatCommandHelp(NEW_SPEC));
    return 2;
  }
  const kind = kindArg as Kind;
  const remainder = rest.join(' ').trim();
  if (!remainder) {
    const label = kind === 'post' || kind === 'page' ? 'title' : 'slug';
    process.stderr.write(`A ${label} is required.\n\n`);
    process.stderr.write(formatCommandHelp(NEW_SPEC));
    return 2;
  }

  const isPost = kind === 'post';
  const isPostOrPage = isPost || kind === 'page';
  const draft = parsed.values.draft === true;
  const dateRaw = typeof parsed.values.date === 'string' ? parsed.values.date.trim() : '';
  const tagsRaw = typeof parsed.values.tags === 'string' ? parsed.values.tags : '';
  const authorRaw = typeof parsed.values.author === 'string' ? parsed.values.author.trim() : '';
  const openEditor = parsed.values.open === true;
  const force = parsed.values.force === true;
  const slugOverrideRaw = typeof parsed.values.slug === 'string' ? parsed.values.slug.trim() : '';

  if (!isPost && (dateRaw || tagsRaw || authorRaw)) {
    process.stderr.write('--date, --tags, and --author are only valid for "post" kind.\n\n');
    process.stderr.write(formatCommandHelp(NEW_SPEC));
    return 2;
  }
  if (!isPostOrPage && draft) {
    process.stderr.write('--draft is only valid for "post" or "page" kind.\n\n');
    process.stderr.write(formatCommandHelp(NEW_SPEC));
    return 2;
  }
  if (!isPostOrPage && slugOverrideRaw) {
    process.stderr.write(
      '--slug is only valid for "post" or "page" kind; for "tag" / "author" the positional is already the slug.\n\n',
    );
    process.stderr.write(formatCommandHelp(NEW_SPEC));
    return 2;
  }

  let isoDate: string | undefined;
  if (dateRaw) {
    const parsedDate = new Date(dateRaw);
    if (Number.isNaN(parsedDate.getTime())) {
      process.stderr.write(`Invalid --date value: ${dateRaw}. Expected an ISO-8601 timestamp.\n`);
      return 2;
    }
    isoDate = parsedDate.toISOString();
  }

  const slugSource = isPostOrPage ? slugOverrideRaw || remainder : remainder;
  const slug = slugify(slugSource, { lower: true, strict: true });
  if (!slug) {
    process.stderr.write('Could not derive a slug from the provided positional or --slug value.\n');
    return 2;
  }

  const cwd = process.cwd();
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    config = await loadConfig({ cwd, configPath });
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }

  const baseDir = baseDirForKind(kind, config);
  const dest = isAbsolute(baseDir) ? join(baseDir, `${slug}.md`) : join(cwd, baseDir, `${slug}.md`);
  await ensureDir(dirname(dest));

  if (!force && (await fileExists(dest))) {
    process.stderr.write(
      `Refusing to overwrite ${dest}. Pass --force to overwrite or --slug <other>.\n`,
    );
    return 1;
  }

  const tagList = parseCsvList(tagsRaw);
  const body = renderFrontmatter({
    kind,
    title: isPostOrPage ? remainder : titleFromSlug(slug),
    slug,
    date: isPost ? (isoDate ?? new Date().toISOString()) : undefined,
    draft: isPostOrPage ? draft : false,
    tags: tagList,
    author: authorRaw,
  });

  await writeFile(dest, body, 'utf8');
  logger.info(`Created ${dest}`);

  if (openEditor) {
    const code = await openInEditor(dest);
    if (code !== 0) return code;
  }

  return 0;
}

function baseDirForKind(kind: Kind, config: Awaited<ReturnType<typeof loadConfig>>): string {
  switch (kind) {
    case 'post':
      return config.content.posts_dir;
    case 'page':
      return config.content.pages_dir;
    case 'tag':
      return config.content.tags_dir;
    case 'author':
      return config.content.authors_dir;
  }
}

interface FrontmatterInput {
  kind: Kind;
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

  if (kind === 'post' || kind === 'page') {
    lines.push(`title: ${JSON.stringify(title)}`);
    lines.push(`slug: ${slug}`);
    if (date) lines.push(`date: ${date}`);
    if (draft) lines.push('status: draft');
    if (kind === 'post') {
      lines.push(`tags: ${formatYamlSlugList(tags)}`);
      lines.push(`authors: ${formatYamlSlugList(author ? [author] : [])}`);
    }
  } else {
    lines.push(`slug: ${slug}`);
    lines.push(`name: ${JSON.stringify(title)}`);
    if (kind === 'tag') {
      lines.push('description: ""');
    } else {
      lines.push('bio: ""');
    }
  }

  lines.push('---', '');
  if (kind === 'post' || kind === 'page') {
    lines.push(`# ${title}`, '', 'Write your content here.', '');
  } else {
    const noun = kind === 'tag' ? 'tag' : 'author';
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
    .map((s) => slugify(s, { lower: true, strict: true }))
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
  const editor = process.env.EDITOR;
  if (!editor) {
    process.stderr.write(
      'Warning: --open was passed but $EDITOR is not set; skipping editor launch.\n',
    );
    return 0;
  }
  const proc = Bun.spawn([editor, path], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) {
    process.stderr.write(`Editor "${editor}" exited with code ${code}.\n`);
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
