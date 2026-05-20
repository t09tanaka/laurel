import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph } from '~/content/model.ts';

export interface MissingAssetReference {
  owner: string;
  url: string;
  file: string;
}

export function findMissingAssetReferences({
  cwd,
  config,
  content,
}: {
  cwd: string;
  config: NectarConfig;
  content: ContentGraph;
}): MissingAssetReference[] {
  const missing: MissingAssetReference[] = [];
  const assetsRoot = resolve(cwd, config.content.assets_dir);

  const report = (url: string | undefined, owner: string): void => {
    const file = resolveLocalContentImage(url, assetsRoot);
    if (file === undefined || existsSync(file)) return;
    missing.push({ owner, url: url ?? '', file });
  };

  for (const post of content.posts) {
    report(post.feature_image, `Post '${post.slug}' feature_image`);
    report(post.og_image, `Post '${post.slug}' og_image`);
    report(post.twitter_image, `Post '${post.slug}' twitter_image`);
  }
  for (const page of content.pages) {
    report(page.feature_image, `Page '${page.slug}' feature_image`);
    report(page.og_image, `Page '${page.slug}' og_image`);
    report(page.twitter_image, `Page '${page.slug}' twitter_image`);
  }
  for (const author of content.authors) {
    report(author.profile_image, `Author '${author.slug}' profile_image`);
    report(author.cover_image, `Author '${author.slug}' cover_image`);
  }
  for (const tag of content.tags) {
    report(tag.feature_image, `Tag '${tag.slug}' feature_image`);
  }
  report(content.site.cover_image, "Site 'cover_image'");
  report(content.site.logo, "Site 'logo'");
  report(content.site.icon, "Site 'icon'");

  return missing;
}

export function formatMissingAssetReference(ref: MissingAssetReference): string {
  return `${ref.owner} references image '${ref.url}' but ${ref.file} is missing on disk.`;
}

function resolveLocalContentImage(url: string | undefined, assetsRoot: string): string | undefined {
  if (!url) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return undefined;
  if (url.startsWith('//')) return undefined;

  const pathPart = url.split(/[?#]/)[0] ?? '';
  if (!pathPart) return undefined;

  const rel = contentImageRelativePath(pathPart);
  if (rel === undefined) return undefined;

  const file = resolve(assetsRoot, rel);
  const fromRoot = relative(assetsRoot, file);
  if (fromRoot === '' || fromRoot.startsWith('..') || fromRoot.includes(`..${'/'}`)) {
    return undefined;
  }
  return file;
}

function contentImageRelativePath(pathPart: string): string | undefined {
  const normalized = pathPart.replaceAll('\\', '/').replace(/^\.?\//, '');
  const marker = 'content/images/';
  const idx = normalized.indexOf(marker);
  if (idx < 0) return undefined;

  const rest = normalized.slice(idx + marker.length);
  if (rest === '' || rest.split('/').includes('..')) return undefined;
  return rest;
}
