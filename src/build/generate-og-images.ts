import { writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph, Page, Post } from '~/content/model.ts';
import { ensureDir } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';
import { escapeXmlText } from './escaping.ts';

// When a post has no feature_image / og_image / twitter_image set, no og:image
// tag is emitted at all and social shares fall back to the platform default.
// This component renders a per-post OG image from a user-supplied SVG template
// (with `{{title}}`, `{{author}}`, `{{site_title}}`, `{{primary_tag}}`,
// `{{excerpt}}` placeholders) at build time, rasterises it to PNG, and points
// og_image at the result.
//
// The rasteriser is @resvg/resvg-js, declared as an optional dependency so
// install does not fail on platforms without a prebuilt binary. If unavailable
// we warn once and skip; we never abort the build over a missing optional dep.

interface ResvgConstructor {
  new (
    svg: Buffer | string,
    opts: {
      fitTo: { mode: 'width'; value: number };
      font?: { loadSystemFonts: boolean };
      background?: string;
    },
  ): {
    render(): { asPng(): Buffer; width: number; height: number };
  };
}

let cachedResvg: ResvgConstructor | null | undefined;

async function loadResvg(): Promise<ResvgConstructor | null> {
  if (cachedResvg !== undefined) return cachedResvg;
  try {
    const mod = (await import('@resvg/resvg-js')) as { Resvg: ResvgConstructor };
    cachedResvg = mod.Resvg;
  } catch (err) {
    logger.warn(
      `OG image generation skipped: @resvg/resvg-js is not installed (${err instanceof Error ? err.message : String(err)})`,
    );
    cachedResvg = null;
  }
  return cachedResvg;
}

export interface GenerateOgImagesOptions {
  cwd: string;
  config: NectarConfig;
  content: ContentGraph;
  outputDir: string;
}

export async function generateOgImages({
  cwd,
  config,
  content,
  outputDir,
}: GenerateOgImagesOptions): Promise<number> {
  const opts = config.components.og_images;
  if (!opts.enabled) return 0;
  if (!opts.template) return 0;

  const templatePath = isAbsolute(opts.template) ? opts.template : join(cwd, opts.template);
  let templateSvg: string;
  try {
    templateSvg = await Bun.file(templatePath).text();
  } catch (err) {
    logger.warn(
      `OG image generation skipped: cannot read template ${templatePath} (${err instanceof Error ? err.message : String(err)})`,
    );
    return 0;
  }

  const targets = collectTargets(content);
  if (targets.length === 0) return 0;

  const Resvg = await loadResvg();
  if (!Resvg) return 0;

  let count = 0;
  for (const target of targets) {
    const ctx = buildTemplateContext(target, content.site);
    const svg = renderTemplate(templateSvg, ctx);

    let png: Buffer;
    try {
      const resvg = new Resvg(svg, {
        fitTo: { mode: 'width', value: opts.width },
        font: { loadSystemFonts: true },
      });
      png = resvg.render().asPng();
    } catch (err) {
      logger.warn(
        `OG image generation failed for ${target.slug}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    const outputRel = join('content/images/og', `${target.slug}.png`);
    const outputPath = join(outputDir, outputRel);
    await ensureDir(dirname(outputPath));
    await writeFile(outputPath, png);

    target.og_image = `/content/images/og/${target.slug}.png`;
    count += 1;
  }

  return count;
}

function collectTargets(content: ContentGraph): (Post | Page)[] {
  const out: (Post | Page)[] = [];
  for (const post of content.posts) {
    if (needsGenerated(post)) out.push(post);
  }
  for (const page of content.pages) {
    if (needsGenerated(page)) out.push(page);
  }
  return out;
}

// Only generate when the author hasn't supplied ANY image. og_image and
// twitter_image are explicit social overrides; feature_image is the post hero
// that ghost-head.ts already falls back to. If any is set we leave it alone so
// the author's choice wins.
function needsGenerated(item: Post | Page): boolean {
  return !item.og_image && !item.twitter_image && !item.feature_image;
}

interface TemplateContext {
  title: string;
  author: string;
  site_title: string;
  primary_tag: string;
  excerpt: string;
}

function buildTemplateContext(item: Post | Page, site: { title: string }): Record<string, string> {
  const ctx: TemplateContext = {
    title: item.title ?? '',
    author: item.primary_author?.name ?? '',
    site_title: site.title ?? '',
    primary_tag: item.primary_tag?.name ?? '',
    excerpt: item.custom_excerpt ?? item.excerpt ?? '',
  };
  return ctx as unknown as Record<string, string>;
}

// Minimal mustache-style substitution. Anything not in the context renders as
// the empty string so a malformed template surface won't break the build.
// Values are XML-escaped before insertion to keep the SVG well-formed and to
// prevent a `<` in a title from terminating a tag.
function renderTemplate(svg: string, ctx: Record<string, string>): string {
  return svg.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_match, key: string) => {
    const value = ctx[key];
    return value !== undefined ? escapeXmlText(value) : '';
  });
}
