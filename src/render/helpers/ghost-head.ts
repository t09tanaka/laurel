import type Handlebars from 'handlebars';
import type { FaviconLink } from '~/build/favicons.ts';
import { joinPath } from '~/theme/assets.ts';
import { nonceAttr } from '~/util/csp.ts';
import { absoluteUrl, absoluteUrlWithBasePath } from '~/util/url.ts';
import type { NectarEngine } from '../engine.ts';

export function registerGhostHeadFootHelpers(engine: NectarEngine): void {
  engine.hb.registerHelper(
    'ghost_head',
    function ghostHeadHelper(this: unknown, options: Handlebars.HelperOptions) {
      const route = options.data?.route as
        | {
            kind?: string;
            url?: string;
            data?: Record<string, unknown>;
            meta?: { canonical?: string };
          }
        | undefined;
      const site = engine.content.site;
      const ctx = this as Record<string, unknown>;
      const basePath = engine.config?.build?.base_path ?? '/';
      const meta = computeMeta(ctx, route, site, basePath);

      const parts: string[] = [];
      parts.push(`<meta name="generator" content="Nectar">`);
      // Surface @site.accent_color to themes as the `--ghost-accent-color`
      // CSS custom property so partials can reference it with
      // `var(--ghost-accent-color)`. The config schema already restricts
      // accent_color to hex triplets, but the value is dropped directly into
      // a <style> block here, so we re-validate as defense-in-depth before
      // injecting. Anything that fails the allowlist is silently dropped.
      const accentColor = sanitizeAccentColor(site.accent_color);
      if (accentColor) {
        parts.push(`<style>:root{--ghost-accent-color:${accentColor}}</style>`);
      }
      if (meta.canonical) {
        parts.push(`<link rel="canonical" href="${escapeAttr(meta.canonical)}">`);
      }
      for (const link of engine.favicons?.links ?? []) {
        parts.push(renderFaviconLink(link, engine.config?.build?.base_path ?? '/'));
      }
      // rel="prev"/"next" for paginated archives. Google deprecated these as a
      // ranking signal, but Bing and feed crawlers still honour them.
      const pagination = paginationUrls(route);
      if (pagination.prev) {
        parts.push(
          `<link rel="prev" href="${escapeAttr(absoluteUrl(site.url, pagination.prev))}">`,
        );
      }
      if (pagination.next) {
        parts.push(
          `<link rel="next" href="${escapeAttr(absoluteUrl(site.url, pagination.next))}">`,
        );
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
      // Open Graph article:* tags. Only emitted on post routes
      // (og:type=article) so non-post pages remain plain `og:type=website`.
      // Dates are normalised to ISO 8601 so consumers like Facebook crawlers
      // can parse them deterministically regardless of the loader's incoming
      // format. Tag and author values come from the post context (`tags` and
      // `authors` arrays the loader attaches) and are emitted one tag per
      // value, matching the OGP spec.
      if (meta.ogType === 'article') {
        const published = toIso8601(ctx.published_at);
        if (published) {
          parts.push(`<meta property="article:published_time" content="${escapeAttr(published)}">`);
        }
        const modified = toIso8601(ctx.updated_at);
        if (modified) {
          parts.push(`<meta property="article:modified_time" content="${escapeAttr(modified)}">`);
        }
        if (Array.isArray(ctx.tags)) {
          for (const tag of ctx.tags as { name?: unknown }[]) {
            const name = typeof tag?.name === 'string' ? tag.name : undefined;
            if (name) {
              parts.push(`<meta property="article:tag" content="${escapeAttr(name)}">`);
            }
          }
        }
        if (Array.isArray(ctx.authors)) {
          for (const author of ctx.authors as { name?: unknown }[]) {
            const name = typeof author?.name === 'string' ? author.name : undefined;
            if (name) {
              parts.push(`<meta property="article:author" content="${escapeAttr(name)}">`);
            }
          }
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
        const rssHref = absoluteUrlWithBasePath(site.url, basePath, 'rss.xml');
        parts.push(
          `<link rel="alternate" type="application/rss+xml" title="${escapeAttr(site.title)}" href="${escapeAttr(rssHref)}">`,
        );
      }

      const jsonLdEntities = buildJsonLd(ctx, route, site, meta, basePath);
      const nonce = nonceAttr(engine.config?.build?.csp_nonce);
      for (const entity of jsonLdEntities) {
        parts.push(
          `<script type="application/ld+json"${nonce}>${escapeJsonForScript(JSON.stringify(entity))}</script>`,
        );
      }

      // Drop-in analytics snippet from [components.analytics]. Emitted before
      // the code injection blocks so an operator who needs to override the
      // upstream tag (e.g. swap in a self-hosted variant) can still do so via
      // codeinjection_head, while plain configurations get the right snippet
      // without writing any HTML.
      const analyticsSnippet = renderAnalyticsSnippet(engine.config?.components?.analytics);
      if (analyticsSnippet) parts.push(analyticsSnippet);

      // Ghost Portal client script. Opt-in via [components.portal].inject_script
      // so plain blogs ship no extra JS. When enabled, the bundled portal.min.js
      // attaches `data-portal="signup|signin|account|upgrade"` click handlers
      // and renders the Ghost-style modal UI. `data-i18n="true"` matches Ghost's
      // own injection so the bundled translations load; `data-ghost` exposes the
      // site URL the client uses as its Members API origin. Themes that ship a
      // `<button data-portal="…">` UI but want offline-safety still render fine
      // because Nectar always also rewrites those buttons via portal-shim.ts.
      const portalSnippet = renderPortalSnippet(engine.config?.components?.portal, site.url);
      if (portalSnippet) parts.push(portalSnippet);

      // Sodo Search client script. Opt-in via [components.search].engine when
      // set to `sodo-search` or `json+sodo-search`. The script reads from the
      // `content/search.json` index Nectar already emits, so themes that wire a
      // `<button data-ghost-search>` trigger (Source / Casper) get a working
      // search UI without a server. Independent of Pagefind / Lunr emitters.
      const sodoSnippet = renderSodoSearchSnippet(engine.config?.components?.search, site.url);
      if (sodoSnippet) parts.push(sodoSnippet);

      // Raw HTML exit (1/2): codeinjection_head ships verbatim into <head>.
      // The loader already drops the field unless `build.allow_code_injection`
      // is true, so reaching here means the operator opted in. See
      // docs/security/threat-model.md §"Render-side raw-HTML exits" for the
      // CSP / review posture this requires. The site-wide block is emitted
      // first so per-post / per-page overrides can shadow earlier `<meta>` or
      // `<script>` tags by appearing later in document order.
      const siteHead = (site as { codeinjection_head?: string }).codeinjection_head;
      if (typeof siteHead === 'string' && siteHead) parts.push(siteHead);
      const head = ctx.codeinjection_head;
      if (typeof head === 'string' && head) parts.push(head);

      return new engine.hb.SafeString(parts.join('\n'));
    },
  );

  // Raw HTML exit (2/2): codeinjection_foot ships verbatim before </body>.
  // Same opt-in gate (`build.allow_code_injection`) as ghost_head; the helper
  // itself never escapes because Ghost themes rely on this being a pass-through
  // for analytics, comments bootstrap, and similar trailing snippets.
  engine.hb.registerHelper('ghost_foot', function ghostFootHelper(this: unknown) {
    const ctx = this as { codeinjection_foot?: string };
    const site = engine.content.site as { codeinjection_foot?: string };
    const parts: string[] = [];
    if (typeof site.codeinjection_foot === 'string' && site.codeinjection_foot) {
      parts.push(site.codeinjection_foot);
    }
    if (typeof ctx.codeinjection_foot === 'string' && ctx.codeinjection_foot) {
      parts.push(ctx.codeinjection_foot);
    }
    return new engine.hb.SafeString(parts.join('\n'));
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
  site: {
    title: string;
    description: string;
    url: string;
    meta_title?: string;
    meta_description?: string;
    og_image?: string;
    og_title?: string;
    og_description?: string;
    twitter_image?: string;
    twitter_title?: string;
    twitter_description?: string;
  },
  basePath: string,
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
  // Fall back through site-wide og_image / twitter_image so a config-only
  // [site].og_image still drives every page's social preview when no per-route
  // image is present.
  const rawImage = ogImage || twitterImage || featureImage || site.og_image || site.twitter_image;
  // Apply base_path so a root-relative `/content/images/foo.jpg` becomes
  // `https://host/blog/content/images/foo.jpg` on a subpath deploy. Absolute
  // http(s) URLs pass through unchanged via absoluteUrlWithBasePath.
  const image = rawImage ? absoluteUrlWithBasePath(site.url, basePath, rawImage) : undefined;
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
  const canonical =
    route?.meta?.canonical ?? absoluteUrlWithBasePath(site.url, basePath, route?.url ?? '/');

  let ogType = 'website';
  if (route?.data?.post) ogType = 'article';

  // Final fallback chain: per-route ctx -> [site].meta_* / og_* / twitter_*
  // -> site.title / site.description. The site-level meta_title / og_title /
  // twitter_title knobs let an operator override the default social preview
  // title without touching every Markdown file.
  const title =
    titleFromCtx || site.og_title || site.twitter_title || site.meta_title || site.title;
  const description =
    descFromCtx ||
    site.og_description ||
    site.twitter_description ||
    site.meta_description ||
    site.description;

  return {
    title,
    description,
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
    | {
        kind?: string;
        url?: string;
        data?: Record<string, unknown>;
        meta?: { canonical?: string };
      }
    | undefined,
  site: {
    title: string;
    url: string;
    logo?: string;
    logo_width?: number;
    logo_height?: number;
  },
  meta: ComputedMeta,
  basePath: string,
): Record<string, unknown>[] {
  const entities: Record<string, unknown>[] = [];
  const kind = route?.kind;

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
      // Loader defaults updated_at to published_at when frontmatter omits it.
      // Emitting an identical dateModified signals "never updated" to Google,
      // so suppress it unless the post was genuinely revised.
      dateModified: ctx.updated_at !== ctx.published_at ? ctx.updated_at : undefined,
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
        logo: buildPublisherLogo(site, basePath),
      },
    });
  } else if (kind === 'tag' || kind === 'author' || kind === 'index') {
    entities.push(buildCollectionPage(route, site, meta));
  } else if (kind === 'home') {
    entities.push(buildHomeWebSite(site, basePath));
  } else {
    entities.push({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: site.title,
      url: site.url,
    });
  }

  const breadcrumb = buildBreadcrumbList(ctx, route, site, meta, basePath);
  if (breadcrumb) entities.push(breadcrumb);

  return entities;
}

// CollectionPage with an ItemList of posts is the Schema.org-recommended shape for
// archive index pages (tag/author/paginated home). The previous stub WebSite was
// semantically wrong because archives aren't the site root and they list posts.
function buildCollectionPage(
  route: { data?: Record<string, unknown> } | undefined,
  site: { title: string; url: string },
  meta: ComputedMeta,
): Record<string, unknown> {
  const posts = Array.isArray(route?.data?.posts)
    ? (route.data.posts as { url?: unknown; title?: unknown }[])
    : [];
  const itemListElement = posts
    .filter(
      (p): p is { url: string; title: string } =>
        !!p && typeof p.url === 'string' && typeof p.title === 'string',
    )
    .map((post, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      url: post.url,
      name: post.title,
    }));
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: meta.title,
    url: meta.canonical,
    description: meta.description,
    isPartOf: { '@type': 'WebSite', name: site.title, url: site.url },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: itemListElement.length,
      itemListElement,
    },
  };
}

// Emit SearchAction on the home WebSite entity so Google can surface a sitelinks
// search box when applicable. We point at `/?s={search_term_string}` which is the
// Ghost convention; client-side search components in themes resolve `?s=` to a query.
function buildHomeWebSite(
  site: { title: string; url: string },
  basePath: string,
): Record<string, unknown> {
  // Search target lives at `${site.url}${base_path}?s=...` so a `/blog/` deploy
  // points the sitelinks search box at the deployed root, not the host root.
  const searchTarget = absoluteUrlWithBasePath(site.url, basePath, '/');
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.title,
    url: site.url,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${searchTarget.replace(/\/$/, '')}/?s={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

// Emit BreadcrumbList JSON-LD so search results can render the path
// (Home > Tag > Post for posts, Home > Tag/Author for archive pages).
// Skipped for the home route and standalone static pages — no useful path there.
function buildBreadcrumbList(
  ctx: Record<string, unknown>,
  route:
    | {
        kind?: string;
        url?: string;
        data?: Record<string, unknown>;
        meta?: { canonical?: string };
      }
    | undefined,
  site: { title: string; url: string },
  meta: ComputedMeta,
  basePath: string,
): Record<string, unknown> | undefined {
  const home = absoluteUrlWithBasePath(site.url, basePath, '/');
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
function buildPublisherLogo(
  site: {
    url: string;
    logo?: string;
    logo_width?: number;
    logo_height?: number;
  },
  basePath: string,
): Record<string, unknown> | undefined {
  if (!site.logo) return undefined;
  return {
    '@type': 'ImageObject',
    url: absoluteUrlWithBasePath(site.url, basePath, site.logo),
    width: site.logo_width ?? 60,
    height: site.logo_height ?? 60,
  };
}

function numericField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// Read prev_url / next_url off route.data.pagination if the current route is a
// paginated archive. The route shape is intentionally loose (the engine accepts
// hand-built routes from unit tests), so we narrow defensively.
function paginationUrls(route: { data?: Record<string, unknown> } | undefined): {
  prev: string | undefined;
  next: string | undefined;
} {
  const pagination = route?.data?.pagination as
    | { prev_url?: unknown; next_url?: unknown }
    | undefined;
  const prev = typeof pagination?.prev_url === 'string' ? pagination.prev_url : undefined;
  const next = typeof pagination?.next_url === 'string' ? pagination.next_url : undefined;
  return { prev, next };
}

// Emit one favicon <link>. Root-relative hrefs are rewritten through the
// configured base_path so a deploy under /blog/ still resolves correctly;
// absolute URLs (e.g. a CDN-hosted icon) are passed through unchanged.
function renderFaviconLink(link: FaviconLink, basePath: string): string {
  const href = /^[a-z][a-z0-9+.-]*:/i.test(link.href)
    ? link.href
    : joinPath(basePath, link.href.replace(/^\/+/, ''));
  const attrs: string[] = [`rel="${escapeAttr(link.rel)}"`, `href="${escapeAttr(href)}"`];
  if (link.type) attrs.push(`type="${escapeAttr(link.type)}"`);
  if (link.sizes) attrs.push(`sizes="${escapeAttr(link.sizes)}"`);
  if (link.color) attrs.push(`color="${escapeAttr(link.color)}"`);
  return `<link ${attrs.join(' ')}>`;
}

// Defense-in-depth allowlist for accent_color before it lands inside a <style>
// block. The config schema already restricts the value to hex triplets, but
// the property is documented as user-controlled and we never want a malformed
// configuration to be able to terminate the <style> tag or inject CSS rules.
// We accept the same hex forms the schema accepts plus a conservative set of
// CSS named colors, and reject everything else by returning undefined (the
// caller then omits the <style> tag entirely).
const NAMED_COLOR_PATTERN = /^[a-zA-Z]{3,32}$/;
const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
function sanitizeAccentColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (HEX_COLOR_PATTERN.test(trimmed)) return trimmed;
  if (NAMED_COLOR_PATTERN.test(trimmed)) return trimmed.toLowerCase();
  return undefined;
}

// Normalise a frontmatter date (string | Date | unknown) into an ISO 8601
// string. Falls back to undefined when the value is missing, the wrong type,
// or unparseable so the caller can omit the meta tag rather than emit garbage.
function toIso8601(value: unknown): string | undefined {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? value.toISOString() : undefined;
  }
  if (typeof value !== 'string' || !value) return undefined;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
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

// Ghost Portal injection. Returns the `<script defer src="…">` tag that
// loads the bundled Portal client, or `undefined` when the operator has not
// opted in via `[components.portal].inject_script = true`. We match Ghost's
// own emit shape (`data-i18n="true"` + `data-ghost="<site.url>"`) so existing
// theme markup keeps working. The script URL is validated to be an absolute
// http(s) or root-relative path — anything else (javascript:, data:, file:)
// is dropped to avoid turning a config typo into an XSS vector. Operators
// who genuinely want to self-host can pass an absolute https URL or a
// site-relative path like `/assets/portal.min.js`.
function renderPortalSnippet(
  cfg: { inject_script?: boolean; script_src?: string } | undefined,
  siteUrl: string,
): string | undefined {
  if (!cfg || cfg.inject_script !== true) return undefined;
  const src = sanitizeScriptSrc(cfg.script_src);
  if (!src) return undefined;
  return `<script defer src="${escapeAttr(src)}" data-i18n="true" data-ghost="${escapeAttr(siteUrl)}"></script>`;
}

// Sodo Search injection. Returns the `<script defer src="…">` tag when the
// search engine is `sodo-search` or `json+sodo-search`. Mirrors Ghost's own
// embed: `data-key` and `data-styles` are left blank (themes wire those when
// they need to), the script reads from the search index Nectar emits.
function renderSodoSearchSnippet(
  cfg: { engine?: string; enabled?: boolean; sodo_search_src?: string } | undefined,
  siteUrl: string,
): string | undefined {
  if (!cfg || cfg.enabled === false) return undefined;
  const engine = cfg.engine;
  if (engine !== 'sodo-search' && engine !== 'json+sodo-search') return undefined;
  const src = sanitizeScriptSrc(cfg.sodo_search_src);
  if (!src) return undefined;
  return `<script defer src="${escapeAttr(src)}" data-sodo-search="${escapeAttr(siteUrl)}"></script>`;
}

// Allowlist the URL forms we want to drop straight into `<script src="…">`:
// absolute http(s) URLs (CDN or self-hosted under a different origin) and
// root-relative paths (self-hosted under the build's own publish root).
// Reject anything else — `javascript:`, `data:`, `vbscript:`, file:, missing
// values — so a typo'd config can't turn into a client-side code execution.
const ALLOWED_SCRIPT_URL_PATTERN = /^(?:https?:\/\/|\/)[^\s<>"']+$/i;
function sanitizeScriptSrc(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!ALLOWED_SCRIPT_URL_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}

// Drop-in analytics snippets per provider. Each branch returns the documented
// upstream embed code verbatim, with the operator-supplied site id escaped
// into the relevant attribute / URL. Privacy concerns (DNT, IP anonymisation,
// cookie banners) are deferred to the provider per their own documentation.
function renderAnalyticsSnippet(
  cfg: { provider?: string; site?: string } | undefined,
): string | undefined {
  if (!cfg) return undefined;
  const provider = cfg.provider;
  if (!provider || provider === 'none') return undefined;
  const site = typeof cfg.site === 'string' ? cfg.site.trim() : '';
  switch (provider) {
    case 'plausible':
      if (!site) return undefined;
      return `<script defer data-domain="${escapeAttr(site)}" src="https://plausible.io/js/script.js"></script>`;
    case 'umami':
      if (!site) return undefined;
      return `<script async defer src="https://cloud.umami.is/script.js" data-website-id="${escapeAttr(site)}"></script>`;
    case 'fathom':
      if (!site) return undefined;
      return `<script src="https://cdn.usefathom.com/script.js" data-site="${escapeAttr(site)}" defer></script>`;
    case 'simpleanalytics':
      // Simple Analytics needs no site id; embedding the script alone is
      // enough. The <noscript> pixel is documented as the JS-disabled
      // fallback so we emit it in the same block.
      return [
        `<script async defer src="https://scripts.simpleanalyticscdn.com/latest.js"></script>`,
        `<noscript><img src="https://queue.simpleanalyticscdn.com/noscript.gif" alt="" referrerpolicy="no-referrer-when-downgrade"></noscript>`,
      ].join('\n');
    case 'googleanalytics': {
      if (!site) return undefined;
      const id = escapeAttr(site);
      // GA4 documented gtag.js snippet. The inline initialiser uses `Date()`
      // not a stringifiable value so we cannot route it through JSON encoding;
      // the measurement id is the only user-supplied piece and we escape it
      // for both the URL and the gtag('config') argument.
      const jsId = id.replace(/'/g, "\\'");
      return [
        `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>`,
        `<script>window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', '${jsId}');</script>`,
      ].join('\n');
    }
    default:
      return undefined;
  }
}
