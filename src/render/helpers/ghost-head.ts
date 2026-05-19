import type Handlebars from 'handlebars';
import { absoluteUrl } from '~/util/url.ts';
import type { NectarEngine } from '../engine.ts';

export function registerGhostHeadFootHelpers(engine: NectarEngine): void {
  engine.hb.registerHelper(
    'ghost_head',
    function ghostHeadHelper(this: unknown, options: Handlebars.HelperOptions) {
      const route = options.data?.route as
        | {
            url?: string;
            data?: Record<string, unknown>;
            meta?: { canonical?: string };
          }
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
        if (meta.imageType) {
          parts.push(`<meta property="og:image:type" content="${escapeAttr(meta.imageType)}">`);
        }
        if (meta.imageWidth !== undefined) {
          parts.push(`<meta property="og:image:width" content="${meta.imageWidth}">`);
        }
        if (meta.imageHeight !== undefined) {
          parts.push(`<meta property="og:image:height" content="${meta.imageHeight}">`);
        }
        if (meta.imageAlt) {
          parts.push(`<meta property="og:image:alt" content="${escapeAttr(meta.imageAlt)}">`);
        }
      }
      parts.push(`<meta name="twitter:card" content="summary_large_image">`);
      parts.push(`<meta name="twitter:title" content="${escapeAttr(meta.title)}">`);
      if (meta.description) {
        parts.push(`<meta name="twitter:description" content="${escapeAttr(meta.description)}">`);
      }
      if (meta.image) {
        parts.push(`<meta name="twitter:image" content="${escapeAttr(meta.image)}">`);
        if (meta.imageAlt) {
          parts.push(`<meta name="twitter:image:alt" content="${escapeAttr(meta.imageAlt)}">`);
        }
      }

      // RSS autodiscovery: browsers and feed readers look for <link rel="alternate">.
      if (engine.config?.components?.rss?.enabled !== false) {
        const rssHref = absoluteUrl(site.url, 'rss.xml');
        parts.push(
          `<link rel="alternate" type="application/rss+xml" title="${escapeAttr(site.title)}" href="${escapeAttr(rssHref)}">`,
        );
      }

      const jsonLdEntities = buildJsonLd(ctx, route, site, meta);
      for (const entity of jsonLdEntities) {
        parts.push(
          `<script type="application/ld+json">${escapeJsonForScript(JSON.stringify(entity))}</script>`,
        );
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
  imageType: string | undefined;
  imageWidth: number | undefined;
  imageHeight: number | undefined;
  imageAlt: string | undefined;
  ogType: string;
}

function computeMeta(
  ctx: Record<string, unknown>,
  route:
    | { url?: string; data?: Record<string, unknown>; meta?: { canonical?: string } }
    | undefined,
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
  const ogImage = ctx.og_image as string | undefined;
  const twitterImage = ctx.twitter_image as string | undefined;
  const featureImage = ctx.feature_image as string | undefined;
  const rawImage = ogImage || twitterImage || featureImage;
  const image = rawImage ? absoluteUrl(site.url, rawImage) : undefined;
  const imageType = image ? mimeTypeForImage(image) : undefined;
  // Width/height come from feature_image probing at load time, so only attach
  // them when the emitted og:image actually points at the feature image (not an
  // explicit og_image / twitter_image override whose dimensions we don't know).
  const useFeatureDims = rawImage === featureImage && !ogImage && !twitterImage;
  const imageWidth = useFeatureDims ? numericField(ctx.feature_image_width) : undefined;
  const imageHeight = useFeatureDims ? numericField(ctx.feature_image_height) : undefined;
  const imageAlt = image ? (ctx.feature_image_alt as string | undefined) : undefined;
  // Canonical is precomputed in route.meta (build/routes.ts:defaultMeta). Fall
  // back to deriving from route.url for callers that hand-construct a partial
  // route object (some unit tests do this).
  const canonical = route?.meta?.canonical ?? absoluteUrl(site.url, route?.url ?? '/');

  let ogType = 'website';
  if (route?.data?.post) ogType = 'article';

  return {
    title: titleFromCtx || site.title,
    description: descFromCtx || site.description,
    canonical,
    image,
    imageType,
    imageWidth,
    imageHeight,
    imageAlt,
    ogType,
  };
}

// Open Graph recommends emitting og:image:type so consumers can decide how to
// render the preview without HEAD'ing the URL. Map by file extension; for any
// unknown / queryless / data URL fall back to undefined (omit the tag rather
// than guess wrong).
function mimeTypeForImage(url: string): string | undefined {
  const pathPart = url.split('?')[0]?.split('#')[0] ?? '';
  const m = pathPart.match(/\.([a-z0-9]+)$/i);
  if (!m) return undefined;
  switch (m[1].toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'svg':
      return 'image/svg+xml';
    default:
      return undefined;
  }
}

function buildJsonLd(
  ctx: Record<string, unknown>,
  route:
    | { url?: string; data?: Record<string, unknown>; meta?: { canonical?: string } }
    | undefined,
  site: {
    title: string;
    url: string;
    logo?: string;
    logo_width?: number;
    logo_height?: number;
  },
  meta: ComputedMeta,
): Record<string, unknown>[] {
  const entities: Record<string, unknown>[] = [];

  if (meta.ogType === 'article' && ctx.id) {
    entities.push({
      '@context': 'https://schema.org',
      '@type': 'Article',
      mainEntityOfPage: { '@type': 'WebPage', '@id': meta.canonical },
      url: meta.canonical,
      headline: meta.title,
      description: meta.description,
      image: buildImageObject(meta.image, ctx),
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
        logo: buildPublisherLogo(site),
      },
    });
  } else {
    entities.push({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: site.title,
      url: site.url,
    });
  }

  const breadcrumb = buildBreadcrumbList(ctx, route, site, meta);
  if (breadcrumb) entities.push(breadcrumb);

  return entities;
}

// Emit BreadcrumbList JSON-LD so search results can render the path
// (Home > Tag > Post for posts, Home > Tag/Author for archive pages).
// Skipped for the home route and standalone static pages — no useful path there.
function buildBreadcrumbList(
  ctx: Record<string, unknown>,
  route:
    | { url?: string; data?: Record<string, unknown>; meta?: { canonical?: string } }
    | undefined,
  site: { title: string; url: string },
  meta: ComputedMeta,
): Record<string, unknown> | undefined {
  const home = absoluteUrl(site.url, '/');
  const items: { name: string; item: string }[] = [{ name: site.title, item: home }];

  if (route?.data?.post && ctx.id) {
    const primaryTag = ctx.primary_tag as { name?: string; url?: string } | undefined;
    if (primaryTag?.name && primaryTag?.url) {
      items.push({ name: primaryTag.name, item: primaryTag.url });
    }
    items.push({ name: meta.title, item: meta.canonical });
  } else if (route?.data?.tag) {
    const tag = route.data.tag as { name?: string; url?: string };
    if (!tag.name || !tag.url) return undefined;
    items.push({ name: tag.name, item: tag.url });
  } else if (route?.data?.author) {
    const author = route.data.author as { name?: string; url?: string };
    if (!author.name || !author.url) return undefined;
    items.push({ name: author.name, item: author.url });
  } else {
    return undefined;
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      item: entry.item,
    })),
  };
}

// Google Rich Results require `image` as an ImageObject with width/height when known.
// We surface dimensions from frontmatter (feature_image_width/height) when present.
function buildImageObject(
  imageUrl: string | undefined,
  ctx: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!imageUrl) return undefined;
  const width = numericField(ctx.feature_image_width);
  const height = numericField(ctx.feature_image_height);
  return {
    '@type': 'ImageObject',
    url: imageUrl,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}

// Google requires publisher.logo to be an ImageObject with width/height.
// In a static SSG we cannot probe image files, so we honour the configured
// logo_width / logo_height and fall back to Ghost's documented 60x60 default
// when the logo is set without explicit dimensions.
function buildPublisherLogo(site: {
  url: string;
  logo?: string;
  logo_width?: number;
  logo_height?: number;
}): Record<string, unknown> | undefined {
  if (!site.logo) return undefined;
  return {
    '@type': 'ImageObject',
    url: absoluteUrl(site.url, site.logo),
    width: site.logo_width ?? 60,
    height: site.logo_height ?? 60,
  };
}

function numericField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Escape characters that could break out of a <script> block or be misparsed as JS.
// JSON.stringify leaves `<`, `>`, `&`, U+2028, U+2029 as-is, which allows
// payloads like `</script>` in user content to terminate the script tag.
function escapeJsonForScript(json: string): string {
  return json
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
