// Per-kind snapshot/frontmatter helpers for the dashboard editor.
//
// Posts and pages share the rich content shape (title/status/feature
// image + markdown body + SEO + taxonomy). Authors and tags only edit
// a small set of frontmatter fields — bio/website/location for authors,
// description/accent_color for tags. Keeping the kind dispatch in a
// single module (pure functions, no DOM) means the EditorView only
// renders the kind-appropriate UI and we can round-trip every shape in
// tests without booting Preact.

import type { DashboardEditorKind, EditorSnapshot } from '../types.ts';
import { normalizeMediaPath } from './format.ts';

type Frontmatter = Record<string, unknown>;

function str(value: unknown, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function listToString(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean).join(', ');
  if (typeof value === 'string') return value;
  return '';
}

function splitList(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function emptyEditorSnapshot(): EditorSnapshot {
  return {
    title: '',
    body: '',
    status: 'published',
    featureImage: '',
    featureImageAlt: '',
    featureImageCaption: '',
    excerpt: '',
    tags: '',
    authors: '',
    publishedAt: '',
    metaTitle: '',
    metaDescription: '',
    canonicalUrl: '',
    slug: '',
    bio: '',
    description: '',
    website: '',
    location: '',
    accentColor: '',
  };
}

export function snapshotFromFrontmatter(
  kind: DashboardEditorKind,
  frontmatter: Frontmatter,
  body: string,
): EditorSnapshot {
  return snapshotFromItem(kind, { frontmatter, body, slug: str(frontmatter.slug) });
}

export function snapshotFromItem(
  kind: DashboardEditorKind,
  item: { frontmatter: Frontmatter; body: string; slug: string },
): EditorSnapshot {
  const fm = item.frontmatter;
  const base = emptyEditorSnapshot();
  base.body = item.body;
  base.slug = str(fm.slug, item.slug);
  if (kind === 'posts' || kind === 'pages') {
    base.title = str(fm.title ?? fm.name);
    base.status = str(fm.status, 'published');
    base.featureImage = str(fm.feature_image);
    base.featureImageAlt = str(fm.feature_image_alt);
    base.featureImageCaption = str(fm.feature_image_caption);
    base.excerpt = str(fm.custom_excerpt ?? fm.excerpt);
    base.tags = listToString(fm.tags);
    base.authors = listToString(fm.authors ?? fm.author);
    base.publishedAt = str(fm.published_at ?? fm.date);
    base.metaTitle = str(fm.meta_title);
    base.metaDescription = str(fm.meta_description);
    base.canonicalUrl = str(fm.canonical_url);
    return base;
  }
  if (kind === 'authors') {
    base.title = str(fm.name);
    base.bio = str(fm.bio);
    // Prefer cover_image when present; fall back to profile_image.
    base.featureImage = str(fm.cover_image ?? fm.profile_image);
    base.website = str(fm.website);
    base.location = str(fm.location);
    return base;
  }
  // tags
  base.title = str(fm.name);
  base.description = str(fm.description);
  base.featureImage = str(fm.feature_image);
  base.accentColor = str(fm.accent_color);
  return base;
}

function setOptional(fm: Frontmatter, key: string, value: string): void {
  if (value) fm[key] = value;
  else Reflect.deleteProperty(fm, key);
}

function dropKey(fm: Frontmatter, key: string): void {
  Reflect.deleteProperty(fm, key);
}

export function buildFrontmatter(
  kind: DashboardEditorKind,
  baseFrontmatter: Frontmatter,
  snapshot: EditorSnapshot,
): Frontmatter {
  const fm: Frontmatter = { ...baseFrontmatter };
  if (kind === 'posts' || kind === 'pages') {
    fm.title = snapshot.title;
    fm.status = snapshot.status;
    fm.updated_at = new Date().toISOString();
    setOptional(fm, 'feature_image', normalizeMediaPath(snapshot.featureImage));
    setOptional(fm, 'feature_image_alt', snapshot.featureImageAlt.trim());
    setOptional(fm, 'feature_image_caption', snapshot.featureImageCaption.trim());
    setOptional(fm, 'custom_excerpt', snapshot.excerpt.trim());
    if (snapshot.excerpt.trim() && 'excerpt' in fm) dropKey(fm, 'excerpt');
    const tagList = splitList(snapshot.tags);
    if (tagList.length) fm.tags = tagList;
    else dropKey(fm, 'tags');
    const authorList = splitList(snapshot.authors);
    if (authorList.length) {
      if (authorList.length > 1) {
        fm.authors = authorList;
        dropKey(fm, 'author');
      } else {
        fm.author = authorList[0];
        dropKey(fm, 'authors');
      }
    } else {
      dropKey(fm, 'authors');
      dropKey(fm, 'author');
    }
    const publishedAt = snapshot.publishedAt.trim();
    if (publishedAt) {
      fm.published_at = publishedAt;
      dropKey(fm, 'date');
    } else {
      dropKey(fm, 'published_at');
      dropKey(fm, 'date');
    }
    setOptional(fm, 'meta_title', snapshot.metaTitle.trim());
    setOptional(fm, 'meta_description', snapshot.metaDescription.trim());
    setOptional(fm, 'canonical_url', snapshot.canonicalUrl.trim());
    return fm;
  }
  if (kind === 'authors') {
    fm.name = snapshot.title;
    setOptional(fm, 'slug', snapshot.slug.trim());
    setOptional(fm, 'bio', snapshot.bio.trim());
    setOptional(fm, 'cover_image', normalizeMediaPath(snapshot.featureImage));
    setOptional(fm, 'website', snapshot.website.trim());
    setOptional(fm, 'location', snapshot.location.trim());
    return fm;
  }
  // tags
  fm.name = snapshot.title;
  setOptional(fm, 'slug', snapshot.slug.trim());
  setOptional(fm, 'description', snapshot.description.trim());
  setOptional(fm, 'feature_image', normalizeMediaPath(snapshot.featureImage));
  setOptional(fm, 'accent_color', snapshot.accentColor.trim());
  return fm;
}
