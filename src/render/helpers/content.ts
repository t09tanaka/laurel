import type Handlebars from 'handlebars';
import type { RecommendationItem } from '~/config/schema.ts';
import { truncateByWords } from '~/content/markdown.ts';
import { nonceAttr } from '~/util/csp.ts';
import { sanitizeHref } from '~/util/safe-href.ts';
import { type NectarEngine, computePostClass } from '../engine.ts';

export function registerContentHelpers(engine: NectarEngine): void {
  engine.hb.registerHelper(
    'content',
    function contentHelper(this: unknown, options: Handlebars.HelperOptions) {
      const ctx = this as Record<string, unknown>;
      const html = typeof ctx.html === 'string' ? ctx.html : '';
      const words = options.hash.words;
      if (typeof words === 'number') {
        return new engine.hb.SafeString(truncateWords(html, words, siteLocale(options)));
      }
      // If the post body carries a loader-injected paywall stub *and* the
      // active theme ships a `partials/paywall.hbs` (override of the built-in
      // default partial), swap the stub for the rendered partial so the
      // theme's copy/markup wins. Without an override we keep the existing
      // `gh-paywall-stub` HTML so existing themes/CSS that hook
      // `.gh-paywall-stub` continue to work end-to-end (issue #207).
      const swapped = replacePaywallStubWithPartial(engine, html, this, options);
      return new engine.hb.SafeString(downshiftHeadings(swapped));
    },
  );

  engine.hb.registerHelper(
    'excerpt',
    function excerptHelper(this: unknown, options: Handlebars.HelperOptions) {
      const ctx = this as Record<string, unknown>;
      const source =
        (typeof ctx.custom_excerpt === 'string' && ctx.custom_excerpt) ||
        (typeof ctx.excerpt === 'string' ? ctx.excerpt : '') ||
        (typeof ctx.plaintext === 'string' ? ctx.plaintext : '');
      const words = parseNum(options.hash.words);
      const characters = parseNum(options.hash.characters);
      if (words) return truncateByWords(source, words, siteLocale(options));
      if (characters) return sliceByCharacters(source, characters);
      return source;
    },
  );

  engine.hb.registerHelper(
    'reading_time',
    function readingTimeHelper(this: unknown, options: Handlebars.HelperOptions) {
      const ctx = this as Record<string, unknown>;
      const minutes = typeof ctx.reading_time === 'number' ? ctx.reading_time : 1;
      const minute = String(options.hash.minute ?? '1 min read');
      const plural = String(options.hash.minutes ?? '% min read');
      if (minutes <= 1) return minute;
      return plural.replace('%', String(minutes));
    },
  );

  engine.hb.registerHelper(
    'authors',
    function authorsHelper(this: unknown, options: Handlebars.HelperOptions) {
      const ctx = this as { authors?: { name: string; url?: string; visibility?: string }[] };
      // Authors in Nectar's content graph don't carry per-row visibility today,
      // but mirror the tags helper API so themes can write the same hash on
      // either. `visibility="all"` is a no-op when no rows are filtered; a
      // restrictive value like `visibility="public"` keeps authors that either
      // declare `public` or omit the field (default), matching Ghost.
      const visibility = parseVisibility(options.hash.visibility);
      const list = (ctx.authors ?? []).filter((author) => {
        if (visibility === 'all') return true;
        const v = author.visibility ?? 'public';
        return visibility.has(v);
      });
      if (options.fn) {
        let out = '';
        for (const author of list) out += options.fn(author);
        return out;
      }
      const separator = typeof options.hash.separator === 'string' ? options.hash.separator : ', ';
      const prefix = typeof options.hash.prefix === 'string' ? options.hash.prefix : '';
      const suffix = typeof options.hash.suffix === 'string' ? options.hash.suffix : '';
      const fallback =
        typeof options.hash.fallback === 'string' ? options.hash.fallback : undefined;
      // Ghost treats only the string 'false' (not the empty/missing hash) as
      // disabling autolink, so undefined/'true'/boolean true all link.
      const autolink = !(options.hash.autolink === false || options.hash.autolink === 'false');
      const limit = parseNum(options.hash.limit);
      const fromRaw = parseNum(options.hash.from);
      const toRaw = parseNum(options.hash.to);

      if (list.length === 0) {
        return new engine.hb.SafeString(fallback ? prefix + escapeHtml(fallback) + suffix : '');
      }

      let items = list.map((author) => {
        if (!autolink || typeof author.url !== 'string' || author.url.length === 0) {
          return escapeHtml(author.name);
        }
        const safeHref = sanitizeHref(author.url, '{{authors}} helper');
        return `<a href="${engine.hb.escapeExpression(safeHref)}">${escapeHtml(author.name)}</a>`;
      });
      if (limit !== undefined && limit >= 0) items = items.slice(0, limit);
      const from = fromRaw && fromRaw > 0 ? fromRaw - 1 : 0;
      const to = toRaw && toRaw > 0 ? toRaw : items.length;
      const joined = items.slice(from, to).join(separator);
      return new engine.hb.SafeString(joined.length > 0 ? prefix + joined + suffix : '');
    },
  );

  engine.hb.registerHelper(
    'tags',
    function tagsHelper(this: unknown, options: Handlebars.HelperOptions) {
      const ctx = this as {
        tags?: { name: string; slug: string; url: string; visibility?: string }[];
      };
      // Ghost's tags helper hides `internal` tags by default; visibility="all"
      // or a comma-separated list (e.g. "public,internal") opts back in.
      const visibility = parseVisibility(options.hash.visibility);
      const list = (ctx.tags ?? []).filter((tag) => {
        if (visibility === 'all') return true;
        const v = tag.visibility ?? 'public';
        return visibility.has(v);
      });
      if (options.fn) {
        let out = '';
        for (const tag of list) out += options.fn(tag);
        return out;
      }
      const separator = typeof options.hash.separator === 'string' ? options.hash.separator : ', ';
      const prefix = typeof options.hash.prefix === 'string' ? options.hash.prefix : '';
      const suffix = typeof options.hash.suffix === 'string' ? options.hash.suffix : '';
      const fallback =
        typeof options.hash.fallback === 'string' ? options.hash.fallback : undefined;
      // Ghost treats only boolean false and the string 'false' as disabling
      // autolink, so undefined/'true'/boolean true all link.
      const autolink = !(options.hash.autolink === false || options.hash.autolink === 'false');
      const limit = parseNum(options.hash.limit);
      const fromRaw = parseNum(options.hash.from);
      const toRaw = parseNum(options.hash.to);

      // `fallback="Untagged"` is Ghost's documented escape hatch for posts that
      // would otherwise emit no tag list at all. We honour it even when the
      // visibility filter wipes out every tag (e.g. only internal tags exist).
      if (list.length === 0) {
        return new engine.hb.SafeString(fallback ? prefix + escapeHtml(fallback) + suffix : '');
      }

      let items = list.map((tag) => {
        if (!autolink || typeof tag.url !== 'string' || tag.url.length === 0) {
          return escapeHtml(tag.name);
        }
        const safeHref = sanitizeHref(tag.url, '{{tags}} helper');
        return `<a href="${engine.hb.escapeExpression(safeHref)}">${escapeHtml(tag.name)}</a>`;
      });
      if (limit !== undefined && limit >= 0) items = items.slice(0, limit);
      const from = fromRaw && fromRaw > 0 ? fromRaw - 1 : 0;
      const to = toRaw && toRaw > 0 ? toRaw : items.length;
      const joined = items.slice(from, to).join(separator);
      return new engine.hb.SafeString(joined.length > 0 ? prefix + joined + suffix : '');
    },
  );

  engine.hb.registerHelper(
    'meta_title',
    function metaTitleHelper(this: unknown, options: Handlebars.HelperOptions) {
      const ctx = this as Record<string, unknown>;
      const route = (options.data?.route ?? {}) as {
        kind?: string;
        data?: Record<string, unknown>;
      };
      const site = options.data?.site as { title?: string } | undefined;
      const explicit = (ctx.meta_title as string | undefined) || (ctx.title as string | undefined);
      const pageSuffix = String(options.hash.page ?? '');

      if (route.kind === 'post' || route.kind === 'page') {
        return explicit ?? site?.title ?? '';
      }
      const baseTitle = explicit ?? site?.title ?? '';
      const pagination = route.data?.pagination as { page?: number } | undefined;
      if (pagination?.page && pagination.page > 1 && pageSuffix) {
        return `${baseTitle}${pageSuffix.replace('%', String(pagination.page))}`;
      }
      return baseTitle;
    },
  );

  engine.hb.registerHelper(
    'meta_description',
    function metaDescriptionHelper(this: unknown, options: Handlebars.HelperOptions) {
      const ctx = this as Record<string, unknown>;
      const route = options.data?.route as { kind?: string } | undefined;
      const site = options.data?.site as { description?: string } | undefined;
      const fallback = site?.description ?? '';

      if (route?.kind === 'tag') {
        const tag = ctx.tag as { meta_description?: string; description?: string } | undefined;
        return tag?.meta_description || tag?.description || fallback;
      }
      if (route?.kind === 'author') {
        const author = ctx.author as { meta_description?: string; bio?: string } | undefined;
        return author?.meta_description || author?.bio || fallback;
      }
      // Ghost emits the first sentence of the post body when no explicit
      // description, excerpt, or site default is available, so search engines
      // never see an empty meta tag. Mirror that chain end-to-end here.
      return (
        (ctx.meta_description as string | undefined) ||
        (ctx.custom_excerpt as string | undefined) ||
        (ctx.og_description as string | undefined) ||
        (ctx.excerpt as string | undefined) ||
        fallback ||
        firstSentence(ctx.plaintext) ||
        ''
      );
    },
  );

  engine.hb.registerHelper(
    'comments',
    function commentsHelper(this: unknown, options: Handlebars.HelperOptions) {
      const cfg = engine.config?.components?.comments;
      const provider = cfg?.provider ?? 'off';
      if (!cfg || provider === 'off') {
        return new engine.hb.SafeString('<div data-nectar-comments></div>');
      }
      const route = options.data?.route as { url?: string } | undefined;
      const site = engine.content?.site as { url?: string } | undefined;
      const ctx = this as { id?: string; url?: string };
      const canonical = buildCanonicalUrl(site?.url, route?.url ?? ctx.url ?? '/');
      const identifier = cfg.identifier ?? (typeof ctx.id === 'string' ? ctx.id : canonical);

      const nonce = engine.config?.build?.csp_nonce;
      switch (provider) {
        case 'giscus':
          return new engine.hb.SafeString(renderGiscusComments(cfg));
        case 'utterances':
          return new engine.hb.SafeString(renderUtterancesComments(cfg));
        case 'disqus':
          return new engine.hb.SafeString(renderDisqusComments(cfg, canonical, identifier, nonce));
        case 'webmention.io':
          return new engine.hb.SafeString(renderWebmentionComments(cfg, canonical));
        default:
          return new engine.hb.SafeString('<div data-nectar-comments></div>');
      }
    },
  );

  engine.hb.registerHelper(
    'recommendations',
    function recommendationsHelper(options?: Handlebars.HelperOptions) {
      const items = engine.config?.recommendations ?? [];
      // Ghost defaults the sidebar helper to 5 entries; the full list lives on
      // the auto-emitted `/recommendations/` page (see build/recommendations-page.ts).
      const limit = parseNum(options?.hash?.limit) ?? 5;
      const visible = limit > 0 ? items.slice(0, limit) : items;
      if (visible.length === 0) {
        return new engine.hb.SafeString(
          '<ul class="recommendations" data-nectar-recommendations></ul>',
        );
      }
      const lis = visible.map((item) => renderRecommendationListItem(item)).join('');
      return new engine.hb.SafeString(
        `<ul class="recommendations" data-nectar-recommendations>${lis}</ul>`,
      );
    },
  );

  // Members surface is out of scope in static builds, so the visitor is always
  // treated as unauthenticated. Themes can rely on `access` being a registered
  // helper that returns `false` rather than an undefined context lookup.
  engine.hb.registerHelper(
    'access',
    function accessHelper(this: unknown, options?: Handlebars.HelperOptions) {
      if (options?.fn) return options.inverse(this);
      return false;
    },
  );

  engine.hb.registerHelper(
    'subscribe_form',
    function subscribeFormHelper(this: unknown, options: Handlebars.HelperOptions) {
      const placeholder = String(options.hash.placeholder ?? 'Your email address');
      const buttonText = String(options.hash.button_text ?? 'Subscribe');
      const label = options.hash.label != null ? String(options.hash.label) : '';
      // `action="#"` is the placeholder Ghost themes ship with — the
      // build-time subscribe adapter (`transformSubscribeForms`) rewrites it
      // to the provider endpoint. The `data-nectar-subscribe` marker lets
      // optional client-side scripts (e.g. an AJAX submitter) hook onto the
      // form without disturbing the Ghost `data-members-form` contract.
      return new engine.hb.SafeString(
        `<form data-members-form="subscribe" data-nectar-subscribe action="#" method="post"><input data-members-email type="email" name="email" required placeholder="${escapeAttr(placeholder)}"><input data-members-label type="hidden" value="${escapeAttr(label)}"><button type="submit"><span>${escapeHtml(buttonText)}</span></button></form>`,
      );
    },
  );

  engine.hb.registerHelper(
    'input_email',
    function inputEmailHelper(this: unknown, options: Handlebars.HelperOptions) {
      const placeholder = String(options.hash.placeholder ?? 'Your email address');
      // `name="email"` is included by default so the bare input is a valid
      // form field even when the surrounding form is not rewritten by an
      // adapter. Provider adapters overwrite the attribute downstream when
      // they need a non-default field name (e.g. Mailchimp wants `EMAIL`).
      return new engine.hb.SafeString(
        `<input data-members-email type="email" name="email" required placeholder="${escapeAttr(placeholder)}">`,
      );
    },
  );

  engine.hb.registerHelper('post_class', function postClassHelper(this: unknown) {
    const ctx = this as {
      tags?: { slug: string }[];
      featured?: boolean;
      feature_image?: string | undefined;
      html?: string;
      page?: boolean;
    };
    return computePostClass(ctx);
  });

  engine.hb.registerHelper(
    'body_class',
    function bodyClassHelper(this: unknown, options: Handlebars.HelperOptions) {
      const route = options.data?.route as { kind?: string } | undefined;
      const ctx = this as { body_class?: string };
      return ctx.body_class ?? (route?.kind ? `nectar-route-${route.kind}` : '');
    },
  );
}

function truncateWords(html: string, words: number, locale: string | undefined): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncateByWords(text, words, locale);
}

function siteLocale(options: Handlebars.HelperOptions): string | undefined {
  const site = options.data?.site as { locale?: unknown } | undefined;
  return typeof site?.locale === 'string' ? site.locale : undefined;
}

// `String.prototype.slice` operates on UTF-16 code units, so a slice that lands
// mid-surrogate-pair on an emoji or astral CJK character emits a lone surrogate
// in the output. Slice by code points instead so the trimmed excerpt stays
// well-formed UTF-16.
function sliceByCharacters(text: string, characters: number): string {
  if (characters <= 0) return '';
  let count = 0;
  let end = 0;
  for (const ch of text) {
    if (count >= characters) break;
    count += 1;
    end += ch.length;
  }
  return text.slice(0, end);
}

// The post/page layout already emits the title as an <h1>, so a body-level <h1>
// would duplicate the page heading. We promote only body <h1> tags to <h2>;
// deeper levels stay as authored so the outline does not skip levels (e.g.
// authoring an `##` no longer produces an `<h3>` after the title `<h1>`, which
// html-validate flags as heading-level skip).
function downshiftHeadings(html: string): string {
  return html.replace(/<(\/?)h1\b/gi, (_match, slash: string) => `<${slash}h2`);
}

// Matches the loader-injected paywall stub block emitted by `buildPaywallStub`.
// We anchor on the opening `<div class="gh-paywall-stub" …>` (plus its
// `data-paywall-visibility` attr so we can recover the original visibility for
// the partial context) and the matching closing `</div>`. The body never
// contains nested divs because `buildPaywallStub` controls the entire markup,
// so a non-greedy match is safe even if multiple stubs were ever emitted.
const PAYWALL_STUB_RE =
  /<div class="gh-paywall-stub" data-paywall-visibility="(members|paid)">[\s\S]*?<\/div>/g;

function replacePaywallStubWithPartial(
  engine: NectarEngine,
  html: string,
  postCtx: unknown,
  options: Handlebars.HelperOptions,
): string {
  if (!html.includes('gh-paywall-stub')) return html;
  // Only swap when the theme ships its own `partials/paywall.hbs` — otherwise
  // we leave the loader stub alone so the long-standing `.gh-paywall-stub`
  // markup (with its `data-portal="signup"` portal hook) stays intact for
  // themes that style it directly.
  const themePartials = engine.theme?.partials;
  if (!themePartials || !('paywall' in themePartials)) return html;
  const partial = engine.hb.partials.paywall;
  if (!partial) return html;
  const compiled = typeof partial === 'function' ? partial : engine.hb.compile(partial as string);
  return html.replace(PAYWALL_STUB_RE, (_, visibility: string) => {
    const merged = {
      ...(typeof postCtx === 'object' && postCtx !== null ? (postCtx as object) : {}),
      visibility,
    };
    try {
      return compiled(merged, { data: options.data });
    } catch {
      return _;
    }
  });
}

export function renderRecommendationListItem(item: RecommendationItem): string {
  const href = escapeAttr(item.url);
  const title = escapeHtml(item.title);
  const desc = item.description
    ? `<p class="recommendation-description">${escapeHtml(item.description)}</p>`
    : '';
  const favicon = item.favicon
    ? `<img class="recommendation-favicon" src="${escapeAttr(item.favicon)}" alt="" loading="lazy">`
    : '';
  return `<li class="recommendation"><a href="${href}" rel="noopener" target="_blank">${favicon}<span class="recommendation-title">${title}</span></a>${desc}</li>`;
}

// Last-resort meta description fallback: take the first sentence of the
// plaintext body so search snippets are never empty. We collapse whitespace
// before searching so an early newline cannot mask the first terminator, and
// we cap the no-punctuation case so a wall-of-text body does not produce a
// 5KB <meta> tag. Abbreviations like "Dr." can split early; we accept that
// tradeoff because the SEO surface prefers a short, real sentence over none.
function firstSentence(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const match = text.match(/[.!?](?=\s|$)/);
  if (match?.index !== undefined) return text.slice(0, match.index + 1);
  return text.length > 200 ? text.slice(0, 200) : text;
}

function parseNum(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function parseVisibility(value: unknown): 'all' | Set<string> {
  if (value === 'all') return 'all';
  if (typeof value !== 'string' || value.length === 0) return new Set(['public']);
  const parts = value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  if (parts.includes('all')) return 'all';
  return parts.length > 0 ? new Set(parts) : new Set(['public']);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

type CommentsConfig = {
  provider?: string;
  repo?: string;
  repo_id?: string;
  category?: string;
  category_id?: string;
  mapping?: string;
  strict?: boolean;
  reactions_enabled?: boolean;
  emit_metadata?: boolean;
  input_position?: string;
  theme?: string;
  lang?: string;
  loading?: string;
  issue_term?: string;
  label?: string;
  shortname?: string;
  identifier?: string;
  username?: string;
};

function renderGiscusComments(cfg: CommentsConfig): string {
  if (!cfg.repo) {
    return '<!-- nectar comments: giscus provider requires components.comments.repo -->';
  }
  const attrs: [string, string][] = [
    ['src', 'https://giscus.app/client.js'],
    ['data-repo', cfg.repo],
    ['data-mapping', cfg.mapping ?? 'pathname'],
    ['data-strict', cfg.strict ? '1' : '0'],
    ['data-reactions-enabled', cfg.reactions_enabled === false ? '0' : '1'],
    ['data-emit-metadata', cfg.emit_metadata ? '1' : '0'],
    ['data-input-position', cfg.input_position ?? 'bottom'],
    ['data-theme', cfg.theme ?? 'preferred_color_scheme'],
    ['data-lang', cfg.lang ?? 'en'],
    ['data-loading', cfg.loading ?? 'lazy'],
    ['crossorigin', 'anonymous'],
  ];
  if (cfg.repo_id) attrs.splice(2, 0, ['data-repo-id', cfg.repo_id]);
  if (cfg.category) attrs.splice(3, 0, ['data-category', cfg.category]);
  if (cfg.category_id) attrs.splice(4, 0, ['data-category-id', cfg.category_id]);
  const rendered = attrs.map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ');
  return `<div data-nectar-comments></div>\n<script ${rendered} async></script>`;
}

function renderUtterancesComments(cfg: CommentsConfig): string {
  if (!cfg.repo) {
    return '<!-- nectar comments: utterances provider requires components.comments.repo -->';
  }
  const attrs: [string, string][] = [
    ['src', 'https://utteranc.es/client.js'],
    ['repo', cfg.repo],
    ['issue-term', cfg.issue_term ?? 'pathname'],
    ['theme', cfg.theme ?? 'github-light'],
    ['crossorigin', 'anonymous'],
  ];
  if (cfg.label) attrs.splice(3, 0, ['label', cfg.label]);
  const rendered = attrs.map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ');
  return `<div data-nectar-comments></div>\n<script ${rendered} async></script>`;
}

function renderDisqusComments(
  cfg: CommentsConfig,
  canonical: string,
  identifier: string,
  cspNonce: string | undefined,
): string {
  if (!cfg.shortname) {
    return '<!-- nectar comments: disqus provider requires components.comments.shortname -->';
  }
  if (!/^[a-z0-9-]+$/i.test(cfg.shortname)) {
    return '<!-- nectar comments: disqus shortname must be alphanumeric/dash only -->';
  }
  const urlJson = escapeForScript(JSON.stringify(canonical));
  const idJson = escapeForScript(JSON.stringify(identifier));
  const shortAttr = escapeAttr(cfg.shortname);
  return [
    '<div id="disqus_thread" data-nectar-comments></div>',
    `<script${nonceAttr(cspNonce)}>`,
    '(function() {',
    '  var disqus_config = function () {',
    `    this.page.url = ${urlJson};`,
    `    this.page.identifier = ${idJson};`,
    '  };',
    '  window.disqus_config = disqus_config;',
    '  var d = document, s = d.createElement("script");',
    `  s.src = "https://${shortAttr}.disqus.com/embed.js";`,
    '  s.setAttribute("data-timestamp", +new Date());',
    '  (d.head || d.body).appendChild(s);',
    '})();',
    '</script>',
  ].join('\n');
}

function renderWebmentionComments(cfg: CommentsConfig, canonical: string): string {
  const parts = [
    'class="webmentions"',
    'data-nectar-comments',
    'data-nectar-webmentions',
    `data-target="${escapeAttr(canonical)}"`,
  ];
  if (cfg.username) parts.push(`data-username="${escapeAttr(cfg.username)}"`);
  return `<div ${parts.join(' ')}></div>`;
}

function buildCanonicalUrl(base: string | undefined, path: string): string {
  if (!base) return path;
  if (/^https?:/i.test(path)) return path;
  try {
    return new URL(path, base.endsWith('/') ? base : `${base}/`).toString();
  } catch {
    return path;
  }
}

function escapeForScript(json: string): string {
  return json
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/[\u2028\u2029]/g, (c) => (c === '\u2028' ? '\\u2028' : '\\u2029'));
}
