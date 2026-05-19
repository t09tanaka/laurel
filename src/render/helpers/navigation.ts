import type Handlebars from 'handlebars';
import { sanitizeHref } from '~/util/safe-href.ts';
import type { NectarEngine } from '../engine.ts';

export function registerNavigationHelpers(engine: NectarEngine): void {
  engine.hb.registerHelper(
    'navigation',
    function navigationHelper(this: unknown, options: Handlebars.HelperOptions) {
      const site = options.data?.site as {
        navigation: { label: string; url: string }[];
        secondary_navigation: { label: string; url: string }[];
      };
      const route = options.data?.route as { url?: string } | undefined;
      const currentUrl = route?.url;
      const type = String(options.hash.type ?? 'primary');
      const items = type === 'secondary' ? site.secondary_navigation : site.navigation;
      const list = items
        .map((item) => {
          const isCurrent =
            currentUrl !== undefined &&
            (currentUrl === item.url || normaliseUrl(currentUrl) === normaliseUrl(item.url));
          const ariaCurrent = isCurrent ? ' aria-current="page"' : '';
          return `<li class="nav-${slugify(item.label)}"${ariaCurrent}><a href="${escapeAttr(item.url)}"${ariaCurrent}>${escapeHtml(item.label)}</a></li>`;
        })
        .join('');
      return new engine.hb.SafeString(`<ul class="nav">${list}</ul>`);
    },
  );

  engine.hb.registerHelper(
    'pagination',
    function paginationHelper(this: unknown, options: Handlebars.HelperOptions) {
      const route = options.data?.route as { data?: { pagination?: PaginationLike } } | undefined;
      const pagination = route?.data?.pagination;
      if (!pagination || pagination.pages <= 1) return new engine.hb.SafeString('');
      const parts: string[] = [
        '<nav class="pagination" role="navigation" aria-label="Pagination">',
      ];
      if (pagination.prev_url) {
        parts.push(
          `<a class="newer-posts" href="${escapeAttr(pagination.prev_url)}">&larr; Newer Posts</a>`,
        );
      }
      parts.push(`<span class="page-number">Page ${pagination.page} of ${pagination.pages}</span>`);
      if (pagination.next_url) {
        parts.push(
          `<a class="older-posts" href="${escapeAttr(pagination.next_url)}">Older Posts &rarr;</a>`,
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
      const route = options.data?.route as { url?: string } | undefined;
      const target = String(options.hash.for ?? '');
      const active = String(options.hash.activeClass ?? 'nav-current');
      if (
        route?.url &&
        (route.url === target || normaliseUrl(route.url) === normaliseUrl(target))
      ) {
        return active;
      }
      return '';
    },
  );
}

interface PaginationLike {
  page: number;
  pages: number;
  prev_url: string | undefined;
  next_url: string | undefined;
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
