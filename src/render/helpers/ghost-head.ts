import type Handlebars from 'handlebars';
import type { NectarEngine } from '../engine.ts';

export function registerGhostHeadFootHelpers(engine: NectarEngine): void {
  engine.hb.registerHelper(
    'ghost_head',
    function ghostHeadHelper(this: unknown, options: Handlebars.HelperOptions) {
      const route = options.data?.route as
        | { url?: string; data?: Record<string, unknown> }
        | undefined;
      const site = engine.content.site;
      const ctx = this as Record<string, unknown>;
      const meta = computeMeta(ctx, route, site);

      const parts: string[] = [];
      parts.push(`<meta name="generator" content="Nectar">`);
      if (meta.canonical) {
        parts.push(`<link rel="canonical" href="${escapeAttr(meta.canonical)}">`);
      }
      if (meta.description) {
        parts.push(`<meta name="description" content="${escapeAttr(meta.description)}">`);
      }
      parts.push(`<meta property="og:site_name" content="${escapeAttr(site.title)}">`);
      parts.push(`<meta property="og:type" content="${meta.ogType}">`);
      parts.push(`<meta property="og:title" content="${escapeAttr(meta.title)}">`);
      if (meta.description) {
        parts.push(`<meta property="og:description" content="${escapeAttr(meta.description)}">`);
      }
      if (meta.canonical) {
        parts.push(`<meta property="og:url" content="${escapeAttr(meta.canonical)}">`);
      }
      if (meta.image) {
        parts.push(`<meta property="og:image" content="${escapeAttr(meta.image)}">`);
      }
      parts.push(`<meta name="twitter:card" content="summary_large_image">`);
      parts.push(`<meta name="twitter:title" content="${escapeAttr(meta.title)}">`);
      if (meta.description) {
        parts.push(`<meta name="twitter:description" content="${escapeAttr(meta.description)}">`);
      }
      if (meta.image) {
        parts.push(`<meta name="twitter:image" content="${escapeAttr(meta.image)}">`);
      }

      const jsonLd = buildJsonLd(ctx, site, meta);
      if (jsonLd) {
        parts.push(`<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`);
      }

      const head = ctx.codeinjection_head;
      if (typeof head === 'string' && head) parts.push(head);

      return new engine.hb.SafeString(parts.join('\n'));
    },
  );

  engine.hb.registerHelper('ghost_foot', function ghostFootHelper(this: unknown) {
    const ctx = this as { codeinjection_foot?: string };
    return new engine.hb.SafeString(ctx.codeinjection_foot ?? '');
  });
}

interface ComputedMeta {
  title: string;
  description: string;
  canonical: string;
  image: string | undefined;
  ogType: string;
}

function computeMeta(
  ctx: Record<string, unknown>,
  route: { url?: string; data?: Record<string, unknown> } | undefined,
  site: { title: string; description: string; url: string },
): ComputedMeta {
  const titleFromCtx =
    (ctx.meta_title as string | undefined) ||
    (ctx.og_title as string | undefined) ||
    (ctx.title as string | undefined);
  const descFromCtx =
    (ctx.meta_description as string | undefined) ||
    (ctx.og_description as string | undefined) ||
    (ctx.excerpt as string | undefined);
  const image =
    (ctx.og_image as string | undefined) ||
    (ctx.twitter_image as string | undefined) ||
    (ctx.feature_image as string | undefined);
  const canonical = absoluteUrl(site.url, route?.url ?? '/');

  let ogType = 'website';
  if (route?.data?.post) ogType = 'article';

  return {
    title: titleFromCtx || site.title,
    description: descFromCtx || site.description,
    canonical,
    image,
    ogType,
  };
}

function buildJsonLd(
  ctx: Record<string, unknown>,
  site: { title: string; url: string; logo?: string },
  meta: ComputedMeta,
): Record<string, unknown> | undefined {
  if (meta.ogType === 'article' && ctx.id) {
    return {
      '@context': 'https://schema.org',
      '@type': 'Article',
      url: meta.canonical,
      headline: meta.title,
      description: meta.description,
      image: meta.image,
      datePublished: ctx.published_at,
      dateModified: ctx.updated_at,
      author: Array.isArray(ctx.authors)
        ? (ctx.authors as { name: string; url?: string }[]).map((a) => ({
            '@type': 'Person',
            name: a.name,
            url: a.url,
          }))
        : undefined,
      publisher: {
        '@type': 'Organization',
        name: site.title,
        url: site.url,
        logo: site.logo
          ? { '@type': 'ImageObject', url: absoluteUrl(site.url, site.logo) }
          : undefined,
      },
    };
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.title,
    url: site.url,
  };
}

function absoluteUrl(base: string, path: string): string {
  if (!base) return path;
  if (/^https?:/.test(path)) return path;
  try {
    return new URL(path, base.endsWith('/') ? base : `${base}/`).toString();
  } catch {
    return path;
  }
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
