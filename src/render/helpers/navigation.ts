import type Handlebars from 'handlebars';
import { sanitizeHref } from '~/util/safe-href.ts';
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
    return active[key] || fallback[key] || key;
  };

  engine.hb.registerHelper(
    'navigation',
    function navigationHelper(this: unknown, options: Handlebars.HelperOptions) {
      const site = options.data?.site as {
        navigation: { label: string; url: string; slug?: string; current?: boolean }[];
        secondary_navigation:
          | { label: string; url: string; slug?: string; current?: boolean }[]
          | undefined;
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
            url: sanitizeHref(String(item.url ?? ''), '{{navigation}} helper'),
          };
        });
        const compiled = engine.hb.compile(themePartial, { noEscape: false });
        const html = compiled({ navigation: enriched, type }, { data: options.data });
        return new engine.hb.SafeString(html);
      }

      const list = items
        .map((item) => {
          // Prefer the enriched fields that buildRootData attaches (so a
          // template-side override or a custom NavigationItem extension is
          // honoured). Fall back to local computation for callers that build
          // engine state by hand (unit tests, partial mocks).
          const slug = item.slug ?? slugify(item.label);
          const isCurrent =
            item.current ??
            (currentUrl !== undefined &&
              (currentUrl === item.url || normaliseUrl(currentUrl) === normaliseUrl(item.url)));
          const ariaCurrent = isCurrent ? ' aria-current="page"' : '';
          const safeUrl = sanitizeHref(String(item.url ?? ''), '{{navigation}} helper');
          return `<li class="nav-${slug}"${ariaCurrent}><a href="${escapeAttr(safeUrl)}"${ariaCurrent}>${escapeHtml(item.label)}</a></li>`;
        })
        .join('');
      return new engine.hb.SafeString(`<ul class="nav">${list}</ul>`);
    },
  );

  engine.hb.registerHelper(
    'pagination',
    function paginationHelper(this: unknown, options: Handlebars.HelperOptions) {
      const route = options.data?.route as
        | { url?: string; data?: { pagination?: PaginationLike } }
        | undefined;
      const pagination = route?.data?.pagination;
      if (!pagination || pagination.pages <= 1) return new engine.hb.SafeString('');

      if (options.fn) {
        const blockContext = {
          ...pagination,
          page_url: currentPaginationPageUrl(pagination, route?.url),
        };
        const html = options.fn(blockContext, {
          data: options.data,
          blockParams: [blockContext],
        });
        return new engine.hb.SafeString(html);
      }

      // Theme override: if the theme ships `partials/pagination.hbs`, render
      // it with the pagination context so theme authors can supply custom
      // markup without forking the helper. Falls through to the bespoke HTML
      // below when no theme partial is present (issues #550 / #465).
      const themePartial = engine.theme?.partials?.pagination;
      if (themePartial) {
        const compiled = engine.hb.compile(themePartial, { noEscape: false });
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
    'link',
    function linkHelper(this: unknown, options: Handlebars.HelperOptions) {
      const rawHref = String(options.hash.href ?? '#');
      const href = sanitizeHref(rawHref, '{{link}} helper');
      const cls = String(options.hash.class ?? '');
      const targetVal = options.hash.target ? String(options.hash.target) : '';
      const target = targetVal ? ` target="${escapeAttr(targetVal)}"` : '';
      const relVal = buildLinkRel(targetVal, options.hash.rel);
      const rel = relVal ? ` rel="${escapeAttr(relVal)}"` : '';
      const inner = options.fn ? options.fn(this) : escapeHtml(href);
      return new engine.hb.SafeString(
        `<a href="${escapeAttr(href)}"${cls ? ` class="${escapeAttr(cls)}"` : ''}${target}${rel}>${inner}</a>`,
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
  prev_url: string | undefined;
  next_url: string | undefined;
  base_url?: string | undefined;
  page_url?: string | undefined;
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
  return text
    .toLowerCase()
    .replace(/[^\w]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function normaliseUrl(url: string): string {
  return url.replace(/\/+$/, '') || '/';
}

function currentRouteClass(options: Handlebars.HelperOptions): string {
  const route = options.data?.route as { url?: string } | undefined;
  const target = String(options.hash.for ?? '');
  const active = String(options.hash.activeClass ?? 'nav-current');
  if (!route?.url || !target) return '';
  if (route.url === target || normaliseUrl(route.url) === normaliseUrl(target)) {
    return active;
  }
  // Treat a directory-style target (trailing slash) as a section root so
  // sub-routes like `/tag/news/page/2/` still highlight the parent
  // `/tag/news/` link. The trailing slash is the opt-in: a bare `/tag/news`
  // target keeps the strict equality semantics above.
  // Compare against the route's normalised form with a trailing slash appended
  // so `/tag/news` (no slash) and `/tag/news/` both qualify as descendants of
  // `/tag/news/`.
  if (target.endsWith('/')) {
    const routeWithSlash = route.url.endsWith('/') ? route.url : `${route.url}/`;
    if (routeWithSlash.startsWith(target)) return active;
  }
  return '';
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
