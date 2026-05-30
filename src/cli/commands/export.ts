import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { renderFeedSafeHtml } from '~/build/feed-safe-html.ts';
import { exportComponentsBundle } from '~/components-bundle/index.ts';
import { loadConfig } from '~/config/loader.ts';
import type { NectarConfig } from '~/config/schema.ts';
import { loadContent } from '~/content/loader.ts';
import { htmlToPlaintext } from '~/content/markdown.ts';
import type { Author, ContentGraph, Page, Post, Tag } from '~/content/model.ts';
import { type EntryKind, exportEntryBundle } from '~/entry-bundle/index.ts';
import { EXIT_CODES, exitCodeForError } from '~/util/errors.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { EXPORT_SPEC } from '../specs.ts';

type ExportFormat = 'json' | 'ghost-json' | 'rss' | 'entry' | 'components';

const EXPORT_FORMATS: readonly ExportFormat[] = [
  'json',
  'ghost-json',
  'rss',
  'entry',
  'components',
];

interface RunExportOptions {
  /** Override `process.cwd()` (tests). */
  cwd?: string;
}

export async function runExport(args: string[], options: RunExportOptions = {}): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(EXPORT_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(EXPORT_SPEC));
      return EXIT_CODES.usage;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(EXPORT_SPEC));
    return EXIT_CODES.ok;
  }

  const formatRaw = parsed.positionals[0];
  if (formatRaw === undefined) {
    process.stderr.write('Missing required argument: <format>\n\n');
    process.stderr.write(formatCommandHelp(EXPORT_SPEC));
    return EXIT_CODES.usage;
  }
  if (!isExportFormat(formatRaw)) {
    process.stderr.write(
      `Unknown export format: ${formatRaw} (expected one of: ${EXPORT_FORMATS.join(', ')})\n\n`,
    );
    process.stderr.write(formatCommandHelp(EXPORT_SPEC));
    return EXIT_CODES.usage;
  }
  const format: ExportFormat = formatRaw;

  const cwd = options.cwd ?? process.cwd();
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  const outputPath = typeof parsed.values.output === 'string' ? parsed.values.output : undefined;
  const pretty = parsed.values.pretty === true;
  const includeDrafts = parsed.values['include-drafts'] === true;

  let config: NectarConfig;
  let content: ContentGraph;
  try {
    config = await loadConfig({ cwd, configPath });
    content =
      format === 'entry' || format === 'components'
        ? ({ posts: [], pages: [], tags: [], authors: [] } as unknown as ContentGraph)
        : await loadContent({ cwd, config, includeDrafts });
  } catch (err) {
    reportError(err, cwd);
    return exitCodeForError(err);
  }

  if (format === 'entry') {
    const slug = parsed.positionals[1];
    if (!slug) {
      process.stderr.write('Missing required argument for entry export: <slug>\n\n');
      process.stderr.write(formatCommandHelp(EXPORT_SPEC));
      return EXIT_CODES.usage;
    }
    const kindRaw = typeof parsed.values.kind === 'string' ? parsed.values.kind : 'post';
    if (kindRaw !== 'post' && kindRaw !== 'page') {
      process.stderr.write(`Invalid --kind value: ${kindRaw} (expected one of: post, page)\n\n`);
      process.stderr.write(formatCommandHelp(EXPORT_SPEC));
      return EXIT_CODES.usage;
    }
    const kind: EntryKind = kindRaw;
    const defaultOut = `${slug}.nectar.zip`;
    const outRel = outputPath ?? defaultOut;
    const abs = isAbsolute(outRel) ? outRel : resolve(cwd, outRel);
    try {
      const { zip, omittedAssets, bundledTags } = await exportEntryBundle({
        cwd,
        config,
        kind,
        slug,
      });
      if (omittedAssets.length > 0) {
        process.stderr.write(
          `Warning: ${omittedAssets.length} asset(s) could not be bundled and were omitted:\n`,
        );
        for (const a of omittedAssets) {
          process.stderr.write(`  ${a}\n`);
        }
      }
      if (bundledTags.length > 0) {
        process.stderr.write(
          `Bundled ${bundledTags.length} tag definition(s): ${bundledTags.join(', ')}\n`,
        );
      }
      await mkdir(dirname(abs), { recursive: true });
      await Bun.write(abs, zip);
    } catch (err) {
      reportError(err, cwd);
      return exitCodeForError(err);
    }
    return EXIT_CODES.ok;
  }

  if (format === 'components') {
    const slugsRaw = typeof parsed.values.slugs === 'string' ? parsed.values.slugs : undefined;
    const slugs = slugsRaw
      ? slugsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const outRel = outputPath ?? 'components.nectar.zip';
    const abs = isAbsolute(outRel) ? outRel : resolve(cwd, outRel);
    try {
      const { zip, exportedSlugs, missing } = await exportComponentsBundle({ cwd, config, slugs });
      if (missing.length > 0) {
        process.stderr.write(`Warning: ${missing.length} unknown component(s) skipped:\n`);
        for (const m of missing) {
          process.stderr.write(`  ${m}\n`);
        }
      }
      await mkdir(dirname(abs), { recursive: true });
      await Bun.write(abs, zip);
      process.stderr.write(`Exported ${exportedSlugs.length} component(s) to ${outRel}\n`);
    } catch (err) {
      reportError(err, cwd);
      return exitCodeForError(err);
    }
    return EXIT_CODES.ok;
  }

  let body: string;
  switch (format) {
    case 'json':
      body = renderJson(content, config, { pretty });
      break;
    case 'ghost-json':
      body = renderGhostJson(content, config, { pretty });
      break;
    case 'rss':
      body = renderRss(content, config);
      break;
  }

  if (outputPath) {
    const abs = isAbsolute(outputPath) ? outputPath : resolve(cwd, outputPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body, 'utf8');
  } else {
    process.stdout.write(body);
    // Trailing newline so the next shell prompt does not glue onto the body
    // (JSON.stringify, the RSS XML, none of them include a final newline).
    if (!body.endsWith('\n')) process.stdout.write('\n');
  }
  return EXIT_CODES.ok;
}

function isExportFormat(s: string): s is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(s);
}

interface JsonOptions {
  pretty: boolean;
}

export function renderJson(content: ContentGraph, config: NectarConfig, opts: JsonOptions): string {
  const body = {
    nectar: {
      schema: 'nectar.export.v1',
      generated_at: new Date().toISOString(),
    },
    site: serializeSite(config),
    posts: content.posts.map(serializePost),
    pages: content.pages.map(serializePage),
    tags: content.tags.map(serializeTag),
    authors: content.authors.map(serializeAuthor),
  };
  return JSON.stringify(body, null, opts.pretty ? 2 : 0);
}

export function renderGhostJson(
  content: ContentGraph,
  config: NectarConfig,
  opts: JsonOptions,
): string {
  // Ghost backup shape: top-level `db: [{ meta, data }]` where `data` carries
  // posts, posts_meta, tags, users, posts_tags, posts_authors, and settings.
  // Importable by stock Ghost via Settings -> Labs -> Import content.
  const users = content.authors.map(serializeGhostUser);
  const tags = content.tags.map(serializeGhostTag);
  const posts: Array<Record<string, unknown>> = [];
  const postsTags: Array<Record<string, unknown>> = [];
  const postsAuthors: Array<Record<string, unknown>> = [];

  const pushPost = (item: Post | Page, kind: 'post' | 'page'): void => {
    posts.push(serializeGhostPost(item, kind));
    if (kind === 'post') {
      const post = item as Post;
      let tagOrder = 0;
      for (const tag of post.tags) {
        postsTags.push({
          post_id: post.id,
          tag_id: tag.id,
          sort_order: tagOrder++,
        });
      }
      let authorOrder = 0;
      for (const author of post.authors) {
        postsAuthors.push({
          post_id: post.id,
          author_id: author.id,
          sort_order: authorOrder++,
        });
      }
    }
  };

  for (const post of content.posts) pushPost(post, 'post');
  for (const page of content.pages) pushPost(page, 'page');

  const body = {
    db: [
      {
        meta: {
          exported_on: Date.now(),
          version: '5.0.0',
        },
        data: {
          posts,
          tags,
          users,
          posts_tags: postsTags,
          posts_authors: postsAuthors,
          settings: serializeGhostSettings(config),
        },
      },
    ],
  };
  return JSON.stringify(body, null, opts.pretty ? 2 : 0);
}

// Standalone RSS renderer used by `nectar export rss`. We deliberately avoid
// calling `emitRss` from `~/build/feeds.ts` because that writer is filesystem-
// bound (writes XML to dist/), and the export command needs to stream the
// document to stdout or a single file. Shape matches the Ghost-compatible
// feed: minimal channel metadata plus one `<item>` per published post.
export function renderRss(content: ContentGraph, config: NectarConfig): string {
  const limit = Math.max(1, config.components.rss.items);
  const fullContent = config.components.rss.full_content;
  const base = config.site.url.replace(/\/$/, '');
  const channelLink = `${base}${config.build.base_path === '/' ? '' : config.build.base_path.replace(/\/$/, '')}`;
  const published = content.posts.filter((p) => p.status === 'published');
  const lastBuildDate = computeLastBuildDate(published);
  const items = published.slice(0, limit).map((post) => renderRssItem(post, base, fullContent));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '<channel>',
    `<title>${escapeXml(config.site.title)}</title>`,
    `<link>${escapeXml(channelLink || base)}</link>`,
    `<description>${escapeXml(config.site.description)}</description>`,
    `<language>${escapeXml(config.site.locale)}</language>`,
    `<lastBuildDate>${lastBuildDate}</lastBuildDate>`,
    '<generator>Nectar</generator>',
    items.join(''),
    '</channel>',
    '</rss>',
  ].join('\n');
}

function renderRssItem(post: Post, base: string, fullContent: boolean): string {
  const link = post.url.startsWith('http')
    ? post.url
    : `${base}${post.url.startsWith('/') ? post.url : `/${post.url}`}`;
  const guid = post.uuid ?? link;
  const guidIsPermaLink = post.uuid ? 'false' : 'true';
  const parts: string[] = [
    '<item>',
    `<title><![CDATA[${escapeCdata(post.title)}]]></title>`,
    `<link>${escapeXml(link)}</link>`,
    `<guid isPermaLink="${guidIsPermaLink}">${escapeXml(guid)}</guid>`,
    `<pubDate>${new Date(post.published_at).toUTCString()}</pubDate>`,
  ];
  for (const author of post.authors) {
    parts.push(`<dc:creator><![CDATA[${escapeCdata(author.name)}]]></dc:creator>`);
  }
  for (const tag of post.tags) {
    if (tag.visibility !== 'public') continue;
    parts.push(`<category><![CDATA[${escapeCdata(tag.name)}]]></category>`);
  }
  parts.push(`<description><![CDATA[${escapeCdata(post.feed_excerpt)}]]></description>`);
  if (fullContent) {
    parts.push(
      `<content:encoded><![CDATA[${escapeCdata(renderFeedSafeHtml(post.feed_html))}]]></content:encoded>`,
    );
  }
  parts.push('</item>');
  return parts.join('');
}

function computeLastBuildDate(posts: Post[]): string {
  let latest = 0;
  for (const post of posts) {
    for (const candidate of [post.updated_at, post.published_at]) {
      const ts = Date.parse(candidate);
      if (!Number.isNaN(ts) && ts > latest) {
        latest = ts;
        break;
      }
    }
  }
  return new Date(latest > 0 ? latest : Date.now()).toUTCString();
}

function serializeSite(config: NectarConfig): Record<string, unknown> {
  return {
    title: config.site.title,
    description: config.site.description,
    url: config.site.url,
    locale: config.site.locale,
    accent_color: config.site.accent_color,
  };
}

function serializePost(post: Post): Record<string, unknown> {
  return {
    id: post.id,
    uuid: post.uuid ?? post.id,
    slug: post.slug,
    title: post.title,
    html: post.html,
    plaintext: htmlToPlaintext(post.html),
    excerpt: post.excerpt,
    custom_excerpt: post.custom_excerpt ?? null,
    feature_image: post.feature_image ?? null,
    featured: post.featured,
    status: post.status,
    visibility: post.visibility,
    published_at: post.published_at,
    updated_at: post.updated_at,
    created_at: post.created_at,
    reading_time: post.reading_time,
    url: post.url,
    canonical_url: post.canonical_url ?? null,
    tags: post.tags.map((t) => t.slug),
    authors: post.authors.map((a) => a.slug),
    primary_tag: post.primary_tag?.slug ?? null,
    primary_author: post.primary_author?.slug ?? null,
  };
}

function serializePage(page: Page): Record<string, unknown> {
  return {
    id: page.id,
    uuid: page.uuid ?? page.id,
    slug: page.slug,
    title: page.title,
    html: page.html,
    plaintext: page.plaintext,
    excerpt: page.excerpt,
    feature_image: page.feature_image ?? null,
    status: page.status,
    visibility: page.visibility,
    published_at: page.published_at,
    updated_at: page.updated_at,
    created_at: page.created_at,
    reading_time: page.reading_time,
    url: page.url,
  };
}

function serializeTag(tag: Tag): Record<string, unknown> {
  return {
    id: tag.id,
    slug: tag.slug,
    name: tag.name,
    description: tag.description,
    feature_image: tag.feature_image ?? null,
    accent_color: tag.accent_color ?? null,
    visibility: tag.visibility,
    canonical_url: tag.canonical_url ?? null,
    meta_title: tag.meta_title ?? null,
    meta_description: tag.meta_description ?? null,
    og_title: tag.og_title ?? null,
    og_description: tag.og_description ?? null,
    og_image: tag.og_image ?? null,
    twitter_title: tag.twitter_title ?? null,
    twitter_description: tag.twitter_description ?? null,
    twitter_image: tag.twitter_image ?? null,
    codeinjection_head: tag.codeinjection_head ?? null,
    codeinjection_foot: tag.codeinjection_foot ?? null,
    url: tag.url,
    count: tag.count,
  };
}

function serializeAuthor(author: Author): Record<string, unknown> {
  return {
    id: author.id,
    slug: author.slug,
    name: author.name,
    bio: author.bio,
    profile_image: author.profile_image ?? null,
    cover_image: author.cover_image ?? null,
    website: author.website ?? null,
    location: author.location ?? null,
    twitter: author.twitter ?? null,
    facebook: author.facebook ?? null,
    linkedin: author.linkedin ?? null,
    bluesky: author.bluesky ?? null,
    mastodon: author.mastodon ?? null,
    threads: author.threads ?? null,
    tiktok: author.tiktok ?? null,
    youtube: author.youtube ?? null,
    instagram: author.instagram ?? null,
    github: author.github ?? null,
    accent_color: author.accent_color ?? null,
    meta_title: author.meta_title ?? null,
    meta_description: author.meta_description ?? null,
    og_title: author.og_title ?? null,
    og_description: author.og_description ?? null,
    og_image: author.og_image ?? null,
    twitter_title: author.twitter_title ?? null,
    twitter_description: author.twitter_description ?? null,
    twitter_image: author.twitter_image ?? null,
    codeinjection_head: author.codeinjection_head ?? null,
    codeinjection_foot: author.codeinjection_foot ?? null,
    url: author.url,
    count: author.count,
  };
}

function serializeGhostPost(item: Post | Page, kind: 'post' | 'page'): Record<string, unknown> {
  return {
    id: item.id,
    uuid: item.uuid ?? item.id,
    title: item.title,
    slug: item.slug,
    mobiledoc: null,
    html: item.html,
    plaintext: 'plaintext' in item ? item.plaintext : htmlToPlaintext(item.html),
    feature_image: item.feature_image ?? null,
    featured: 'featured' in item ? item.featured : false,
    type: kind,
    status: item.status,
    visibility: item.visibility,
    created_at: item.created_at,
    updated_at: item.updated_at,
    published_at: item.published_at,
    custom_excerpt: 'custom_excerpt' in item ? (item.custom_excerpt ?? null) : null,
    codeinjection_head: 'codeinjection_head' in item ? (item.codeinjection_head ?? null) : null,
    codeinjection_foot: 'codeinjection_foot' in item ? (item.codeinjection_foot ?? null) : null,
    meta_title: item.meta_title ?? null,
    meta_description: item.meta_description ?? null,
    og_image: 'og_image' in item ? (item.og_image ?? null) : null,
    og_title: 'og_title' in item ? (item.og_title ?? null) : null,
    og_description: 'og_description' in item ? (item.og_description ?? null) : null,
    twitter_image: 'twitter_image' in item ? (item.twitter_image ?? null) : null,
    twitter_title: 'twitter_title' in item ? (item.twitter_title ?? null) : null,
    twitter_description: 'twitter_description' in item ? (item.twitter_description ?? null) : null,
  };
}

function serializeGhostTag(tag: Tag): Record<string, unknown> {
  return {
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    description: tag.description,
    feature_image: tag.feature_image ?? null,
    accent_color: tag.accent_color ?? null,
    visibility: tag.visibility,
    meta_title: tag.meta_title ?? null,
    meta_description: tag.meta_description ?? null,
  };
}

function serializeGhostUser(author: Author): Record<string, unknown> {
  return {
    id: author.id,
    name: author.name,
    slug: author.slug,
    email: `${author.slug}@example.invalid`,
    profile_image: author.profile_image ?? null,
    cover_image: author.cover_image ?? null,
    bio: author.bio,
    website: author.website ?? null,
    location: author.location ?? null,
    facebook: author.facebook ?? null,
    twitter: author.twitter ?? null,
    linkedin: author.linkedin ?? null,
    bluesky: author.bluesky ?? null,
    mastodon: author.mastodon ?? null,
    threads: author.threads ?? null,
    tiktok: author.tiktok ?? null,
    youtube: author.youtube ?? null,
    instagram: author.instagram ?? null,
    github: author.github ?? null,
    accessibility: null,
    status: 'active',
    accent_color: author.accent_color ?? null,
    meta_title: author.meta_title ?? null,
    meta_description: author.meta_description ?? null,
    og_title: author.og_title ?? null,
    og_description: author.og_description ?? null,
    og_image: author.og_image ?? null,
    twitter_title: author.twitter_title ?? null,
    twitter_description: author.twitter_description ?? null,
    twitter_image: author.twitter_image ?? null,
    codeinjection_head: author.codeinjection_head ?? null,
    codeinjection_foot: author.codeinjection_foot ?? null,
  };
}

function serializeGhostSettings(config: NectarConfig): Array<Record<string, unknown>> {
  // Ghost stores settings as a flat key/value list with a `group` tag; only
  // a handful are required by importers. Covering site core, theme, and feed
  // identifiers keeps round-trip tooling (Ghost Admin Import) from crashing.
  const entries: Array<[string, string | null, string]> = [
    ['title', config.site.title, 'site'],
    ['description', config.site.description, 'site'],
    ['url', config.site.url, 'site'],
    ['locale', config.site.locale, 'site'],
    ['timezone', config.site.timezone, 'site'],
    ['accent_color', config.site.accent_color, 'site'],
  ];
  return entries.map(([key, value, group]) => ({ key, value, group }));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeCdata(value: string): string {
  return value.replace(/]]>/g, ']]]]><![CDATA[>');
}
