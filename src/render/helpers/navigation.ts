import type Handlebars from 'handlebars';
import { sanitizeHref } from '~/util/safe-href.ts';
import { withBasePath } from '~/util/url.ts';
import type { NectarEngine } from '../engine.ts';

export function registerNavigationHelpers(engine: NectarEngine): void {
  // Resolve a translator lazily from the engine state. Tests register
  // navigation helpers against a partial engine where `content.site` and
  // `theme.locales` are `{}` placeholders, so we always fall through to the
  // English key when nothing matches (`{}[k] || {}[k] || key === key`).
  const translate = (key: string): string => {
    const locale = engine.content?.site?.locale ?? '';
    const locales = engine.theme?.locales ?? {};
    const active = locales[locale] ?? {};
    const fallback = locales.en ?? {};
    if (Object.prototype.hasOwnProperty.call(active, key)) {
      return String(active[key] ?? '');
    }
    if (Object.prototype.hasOwnProperty.call(fallback, key)) {
      return String(fallback[key] ?? '');
    }
    return key;
  };

  engine.hb.registerHelper(
    'navigation',
    function navigationHelper(this: unknown, options: Handlebars.HelperOptions) {
      const site = options.data?.site as {
        locale?: string;
        navigation: NavigationHelperItem[];
        secondary_navigation: NavigationHelperItem[] | undefined;
      };
      const route = options.data?.route as { url?: string } | undefined;
      const currentUrl = route?.url;
      const type = String(options.hash.type ?? 'primary');
      // `secondary_navigation` is `undefined` when the operator didn't
      // configure one (see #324 — empty arrays are coerced to undefined so
      // `{{#unless @site.secondary_navigation}}` works). Falling back to `[]`
      // here keeps `{{navigation type="secondary"}}` emitting an empty `<ul>`
      // instead of crashing.
      const items = type === 'secondary' ? (site.secondary_navigation ?? []) : site.navigation;
      const basePath = engine.config?.build?.base_path;

      // Theme override: if the theme ships `partials/navigation.hbs`, render
      // it with the resolved navigation context so theme authors can supply
      // custom markup without forking the helper. Falls through to the
      // bespoke HTML below when no theme partial is present (issues
      // #549 / #464).
      const themePartial = engine.theme?.partials?.navigation;
      if (themePartial) {
        const enriched = items.map((item) => {
          const slug = item.slug ?? slugify(item.label);
          const isCurrent =
            item.current ??
            (currentUrl !== undefined &&
              (currentUrl === item.url || normaliseUrl(currentUrl) === normaliseUrl(item.url)));
          return {
            ...item,
            slug,
            current: isCurrent,
            url: navigationHref(String(item.url ?? ''), basePath),
          };
        });
        const registeredPartial = engine.hb.partials.navigation;
        const compiled =
          typeof registeredPartial === 'function'
            ? registeredPartial
            : engine.hb.compile(themePartial);
        const html = compiled(
          { navigation: enriched, type, isSecondary: type === 'secondary' },
          { data: options.data },
        );
        return new engine.hb.SafeString(html);
      }

      if (!engine.navigationHtmlCache) {
        engine.navigationHtmlCache = new Map();
      }
      const cache = engine.navigationHtmlCache;
      const locale = String(site.locale ?? engine.content?.site?.locale ?? '');
      const cacheKey = navigationCacheKey(type, locale, basePath, currentUrl, items);
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      const list = renderNavigationItems(items, currentUrl, basePath, type === 'secondary');
      const html = new engine.hb.SafeString(`<ul class="nav">${list}</ul>`);
      cache.set(cacheKey, html);
      return html;
    },
  );

  engine.hb.registerHelper(
    'pagination',
    function paginationHelper(this: unknown, options: Handlebars.HelperOptions) {
      const route = options.data?.route as
        | { url?: string; data?: { pagination?: PaginationLike } }
        | undefined;
      const pagination = paginationContext(route?.data?.pagination, route?.url);
      if (!pagination || pagination.pages <= 1) return new engine.hb.SafeString('');

      if (options.fn) {
        const html = options.fn(pagination, {
          data: options.data,
          blockParams: [pagination],
        });
        return new engine.hb.SafeString(html);
      }

      // Theme override: if the theme ships `partials/pagination.hbs`, render
      // it with the pagination context so theme authors can supply custom
      // markup without forking the helper. Falls through to the bespoke HTML
      // below when no theme partial is present (issues #550 / #465).
      const themePartial = engine.theme?.partials?.pagination;
      if (themePartial) {
        const registeredPartial = engine.hb.partials.pagination;
        const compiled =
          typeof registeredPartial === 'function'
            ? registeredPartial
            : engine.hb.compile(themePartial);
        const html = compiled(pagination, { data: options.data });
        return new engine.hb.SafeString(html);
      }

      const parts: string[] = [
        '<nav class="pagination" role="navigation" aria-label="Pagination">',
      ];
      // Translate the visible labels through the theme's locale files so a
      // Japanese / French / etc. theme renders pagination in its own language.
      // English remains the fallback when the active locale has no entry,
      // matching the {{t}} helper's lookup order (active -> en -> key).
      const newerLabel = escapeHtml(translate('Newer Posts'));
      const olderLabel = escapeHtml(translate('Older Posts'));
      const pageLabel = escapeHtml(translate('Page'));
      const ofLabel = escapeHtml(translate('of'));
      if (pagination.prev_url) {
        const safePrev = sanitizeHref(pagination.prev_url, '{{pagination}} helper (prev_url)');
        parts.push(
          `<a class="newer-posts" href="${escapeAttr(safePrev)}">&larr; ${newerLabel}</a>`,
        );
      }
      parts.push(
        `<span class="page-number">${pageLabel} ${pagination.page} ${ofLabel} ${pagination.pages}</span>`,
      );
      if (pagination.next_url) {
        const safeNext = sanitizeHref(pagination.next_url, '{{pagination}} helper (next_url)');
        parts.push(
          `<a class="older-posts" href="${escapeAttr(safeNext)}">${olderLabel} &rarr;</a>`,
        );
      }
      parts.push('</nav>');
      return new engine.hb.SafeString(parts.join(''));
    },
  );

  engine.hb.registerHelper(
    'secondary_navigation',
    function secondaryNavigationHelper(this: unknown, options: Handlebars.HelperOptions) {
      const site = options.data?.site as
        | {
            secondary_navigation?:
              | { label: string; url: string; slug?: string; current?: boolean }[]
              | undefined;
          }
        | undefined;
      const items = site?.secondary_navigation ?? [];
      if (options.fn) {
        if (items.length === 0) return options.inverse ? options.inverse(this) : '';
        let out = '';
        for (const item of items) out += options.fn(item);
        return out;
      }
      return items;
    },
  );

  engine.hb.registerHelper(
    'link',
    function linkHelper(this: unknown, options: Handlebars.HelperOptions) {
      const rawHref = String(options.hash.href ?? '#');
      const href = sanitizeHref(rawHref, '{{link}} helper');
      const cls = mergeClassNames(
        String(options.hash.class ?? ''),
        currentRouteClass(options, { target: href }),
      );
      const targetVal = options.hash.target ? String(options.hash.target) : '';
      const target = targetVal ? ` target="${escapeAttr(targetVal)}"` : '';
      const relVal = buildLinkRel(targetVal, options.hash.rel);
      const rel = relVal ? ` rel="${escapeAttr(relVal)}"` : '';
      const dataAttrs = linkDataAttributes(options.hash);
      const inner = options.fn ? options.fn(this) : escapeHtml(href);
      return new engine.hb.SafeString(
        `<a href="${escapeAttr(href)}"${cls ? ` class="${escapeAttr(cls)}"` : ''}${target}${rel}${dataAttrs}>${inner}</a>`,
      );
    },
  );

  engine.hb.registerHelper(
    'link_class',
    function linkClassHelper(this: unknown, options: Handlebars.HelperOptions) {
      return currentRouteClass(options);
    },
  );

  engine.hb.registerHelper(
    'is_active',
    function isActiveHelper(this: unknown, options: Handlebars.HelperOptions) {
      return currentRouteClass(options);
    },
  );
}

interface PaginationLike {
  page: number;
  pages: number;
  total: number;
  prev_url: string | undefined;
  next_url: string | undefined;
  base_url?: string | undefined;
  page_url?: string | undefined;
}

function paginationContext(
  pagination: PaginationLike | undefined,
  routeUrl: string | undefined,
): PaginationLike | undefined {
  if (!pagination) return undefined;
  const page = positiveInteger(pagination.page, 1);
  const pages = positiveInteger(pagination.pages, 1);
  const total = nonNegativeInteger(pagination.total, 0);
  const normalized = {
    ...pagination,
    page,
    pages,
    total,
  };
  return {
    ...normalized,
    page_url: currentPaginationPageUrl(normalized, routeUrl),
  };
}

function positiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function currentPaginationPageUrl(
  pagination: PaginationLike,
  routeUrl: string | undefined,
): string {
  if (pagination.page_url) return pagination.page_url;
  if (routeUrl) return routeUrl;
  const baseUrl = pagination.base_url;
  if (!baseUrl) return '';
  if (pagination.page <= 1) return baseUrl;
  return `${baseUrl.replace(/\/?$/, '/')}page/${pagination.page}/`;
}

function slugify(text: string): string {
  const tokens: string[] = [];
  let ascii = '';
  for (const char of text.normalize('NFKC').toLowerCase()) {
    if (/^[a-z0-9_]$/.test(char)) {
      ascii += char;
      continue;
    }
    if (ascii) {
      tokens.push(ascii);
      ascii = '';
    }
    if (/\p{Letter}|\p{Number}/u.test(char)) {
      tokens.push(`u${char.codePointAt(0)?.toString(16) ?? ''}`);
    }
  }
  if (ascii) tokens.push(ascii);
  return tokens.filter(Boolean).join('-') || 'item';
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const SAFE_DATA_ATTR_RE = /^data-[A-Za-z0-9_.:-]+$/;

function linkDataAttributes(hash: Record<string, unknown>): string {
  return Object.entries(hash)
    .filter(([name]) => SAFE_DATA_ATTR_RE.test(name))
    .map(([name, value]) => ` ${name}="${escapeAttr(String(value ?? ''))}"`)
    .join('');
}

function normaliseUrl(url: string): string {
  return url.replace(/\/+$/, '') || '/';
}

function mergeClassNames(...values: string[]): string {
  const tokens = values.flatMap((value) => value.split(/\s+/).filter(Boolean));
  return Array.from(new Set(tokens)).join(' ');
}

const URL_SCHEME_RE = /^[a-z][a-z0-9+.\-]*:/i;

function navigationHref(value: string, basePath: string | undefined): string {
  const href = sanitizeHref(value, '{{navigation}} helper');
  if (!shouldApplyBasePath(href)) return href;
  return withBasePath(basePath, href);
}

type NavigationHelperItem = {
  label: string;
  url: string;
  slug?: string;
  current?: boolean;
  icon?: string;
  external?: boolean;
  target?: '_blank' | '_self' | '_parent' | '_top';
};

function renderNavigationItems(
  items: NavigationHelperItem[],
  currentUrl: string | undefined,
  basePath: string | undefined,
  isSecondary = false,
): string {
  return items
    .map((item) => {
      // Prefer the enriched fields that buildRootData attaches (so a
      // template-side override or a custom NavigationItem extension is
      // honoured). Fall back to local computation for callers that build
      // engine state by hand (unit tests, partial mocks).
      const slug = item.slug ?? slugify(item.label);
      const isCurrent = isCurrentNavigationItem(item, currentUrl);
      const ariaCurrent = isCurrent ? ' aria-current="page"' : '';
      const safeUrl = navigationHref(String(item.url ?? ''), basePath);
      const icon = item.icon ? ` data-nav-icon="${escapeAttr(item.icon)}"` : '';
      const target = item.target ? ` target="${escapeAttr(item.target)}"` : '';
      const rel = navigationRel(item);
      const relAttr = rel ? ` rel="${escapeAttr(rel)}"` : '';
      const className = isSecondary ? `nav-secondary nav-${slug}` : `nav-${slug}`;
      return `<li class="${className}"${ariaCurrent}${icon}><a href="${escapeAttr(safeUrl)}"${ariaCurrent}${target}${relAttr}>${escapeHtml(item.label)}</a></li>`;
    })
    .join('');
}

function navigationRel(item: NavigationHelperItem): string {
  const parts: string[] = [];
  if (item.external === true) parts.push('external');
  if (item.target === '_blank') parts.push('noopener', 'noreferrer');
  return [...new Set(parts)].join(' ');
}

function navigationCacheKey(
  type: string,
  locale: string,
  basePath: string | undefined,
  currentUrl: string | undefined,
  items: NavigationHelperItem[],
): string {
  return JSON.stringify({
    type,
    locale,
    basePath: basePath ?? '',
    // `aria-current` is part of the helper output, so keep route/current state
    // in the key instead of incorrectly sharing one nav across all pages.
    current: items.map((item) => isCurrentNavigationItem(item, currentUrl)),
    items: items.map((item) => [
      item.label,
      item.url,
      item.slug ?? '',
      item.icon ?? '',
      item.external === true,
      item.target ?? '',
    ]),
  });
}

function isCurrentNavigationItem(
  item: NavigationHelperItem,
  currentUrl: string | undefined,
): boolean {
  return (
    item.current ??
    (currentUrl !== undefined &&
      (currentUrl === item.url || normaliseUrl(currentUrl) === normaliseUrl(item.url)))
  );
}

function shouldApplyBasePath(href: string): boolean {
  if (!href || href.startsWith('#') || href.startsWith('?')) return false;
  if (href.startsWith('//') || URL_SCHEME_RE.test(href)) return false;
  return href.startsWith('/') || /^[A-Za-z0-9._~-]/.test(href);
}

function currentRouteClass(
  options: Handlebars.HelperOptions,
  override: { target?: string } = {},
): string {
  const route = options.data?.route as { url?: string } | undefined;
  const routeUrl = route?.url;
  const target = override.target ?? String(options.hash.for ?? '');
  const active = String(options.hash.activeClass ?? 'nav-current');
  if (!routeUrl || !target) return '';
  if (isCurrentRouteTarget(routeUrl, target)) return active;
  return '';
}

function isCurrentRouteTarget(routeUrl: string, target: string): boolean {
  if (routeUrl === target) return true;
  const current = normaliseUrl(routeUrl);
  const sectionRoot = normaliseUrl(target);
  if (current === sectionRoot) return true;

  // Treat a directory-style target (trailing slash) as a section root so
  // sub-routes like `/tag/news/page/2/` still highlight the parent
  // `/tag/news/` link. The trailing slash is the opt-in: a bare `/tag/news`
  // target keeps the strict equality semantics above.
  // Compare against the route's normalised form with a trailing slash appended
  // so `/tag/news` (no slash) and `/tag/news/` both qualify as descendants of
  // `/tag/news/`.
  if (target.endsWith('/')) {
    const currentWithSlash = current.endsWith('/') ? current : `${current}/`;
    const sectionRootWithSlash = sectionRoot.endsWith('/') ? sectionRoot : `${sectionRoot}/`;
    if (currentWithSlash.startsWith(sectionRootWithSlash)) return true;
  }
  return false;
}

// target="_blank" leaks window.opener to the destination page, letting it
// navigate the opener via JS (reverse-tabnabbing). Force noopener+noreferrer
// whenever a theme uses _blank, while preserving any rel tokens the theme
// already supplied (so a deliberate `rel="external nofollow"` is kept and
// merely augmented). Comparison is case-insensitive because HTML treats
// target values that way; rel tokens are deduped after lower-casing.
function buildLinkRel(targetVal: string, relHash: unknown): string {
  const relInput = relHash === undefined || relHash === null ? '' : String(relHash);
  const tokens = new Set(
    relInput
      .split(/\s+/)
      .map((token) => token.toLowerCase())
      .filter(Boolean),
  );
  if (targetVal.toLowerCase() === '_blank') {
    tokens.add('noopener');
    tokens.add('noreferrer');
  }
  return Array.from(tokens).join(' ');
}
