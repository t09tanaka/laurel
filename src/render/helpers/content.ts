import renderHtml from 'dom-serializer';
import type { ChildNode, Element } from 'domhandler';
import type Handlebars from 'handlebars';
import { parseDocument } from 'htmlparser2';
import type { RecommendationItem } from '~/config/schema.ts';
import { truncateByWords } from '~/content/markdown.ts';
import { nonceAttr } from '~/util/csp.ts';
import { sanitizeHref } from '~/util/safe-href.ts';
import { DEFAULT_PARTIALS } from '../default-partials.ts';
import { type NectarEngine, computePostClass } from '../engine.ts';

export function registerContentHelpers(engine: NectarEngine): void {
  const tagMarkupCache = new WeakMap<
    { name: string; url?: string },
    { name: string; url: string | undefined; escapedName: string; linkedHtml: string | undefined }
  >();

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
      const source = publicSafeExcerpt(ctx);
      const words = parseNum(options.hash.words);
      const characters = parseNum(options.hash.characters);
      if (words) return truncateByWords(source, words, siteLocale(options));
      if (characters) return truncateCharactersAtWordBoundary(source, characters);
      return source;
    },
  );

  engine.hb.registerHelper(
    'reading_time',
    function readingTimeHelper(this: unknown, options: Handlebars.HelperOptions) {
      const ctx = this as Record<string, unknown>;
      const minutes = typeof ctx.reading_time === 'number' ? ctx.reading_time : 1;
      const minute = String(options.hash.minute ?? translate(engine, options, '1 min read'));
      const plural = String(options.hash.minutes ?? translate(engine, options, '% min read'));
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
      const separator = hashString(options.hash.separator) ?? ', ';
      const prefix = hashString(options.hash.prefix) ?? '';
      const suffix = hashString(options.hash.suffix) ?? '';
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
      // Some themes use includeHidden=true for the same intent; treat it as
      // the documented all-visibility path rather than adding another filter.
      const visibility =
        options.hash.includeHidden === true || options.hash.includeHidden === 'true'
          ? 'all'
          : parseVisibility(options.hash.visibility);
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

      let items = list.map((tag) => renderTagListItem(tag, autolink, tagMarkupCache, engine));
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
      const explicit = firstNonEmptyString(ctx.meta_title, ctx.title);
      const pageSuffix = String(options.hash.page ?? '');

      if (route.kind === 'post' || route.kind === 'page') {
        return explicit ?? site?.title ?? '';
      }
      const baseTitle = routeScopedMetaTitle(ctx, route) ?? explicit ?? site?.title ?? '';
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
        publicSafeGeneratedExcerpt(ctx) ||
        fallback ||
        publicSafeFirstSentence(ctx) ||
        ''
      );
    },
  );

  engine.hb.registerHelper(
    'comments',
    function commentsHelper(this: unknown, options: Handlebars.HelperOptions) {
      const ctx = this as { id?: string; url?: string; comments?: unknown };
      // Ghost lets editors disable comments per-post via the `comments` boolean
      // on the post payload. When `post.comments === false` the helper must
      // emit nothing so themes' `{{#if comments}}…{{comments}}…{{/if}}` blocks
      // stay collapsed and no provider script loads. Undefined/true keep the
      // existing behaviour (placeholder div or configured provider).
      if (ctx.comments === false) {
        return new engine.hb.SafeString('');
      }
      const cfg = engine.config?.components?.comments;
      const provider = cfg?.provider ?? 'off';
      const hashAttrs = commentsHashAttrs(options.hash);
      if (!cfg || provider === 'off') {
        return new engine.hb.SafeString(renderCommentsContainer(hashAttrs));
      }
      const route = options.data?.route as { url?: string } | undefined;
      const site = engine.content?.site as { url?: string } | undefined;
      const canonical = buildCanonicalUrl(site?.url, route?.url ?? ctx.url ?? '/');
      const identifier = cfg.identifier ?? (typeof ctx.id === 'string' ? ctx.id : canonical);

      const nonce = engine.config?.build?.csp_nonce;
      switch (provider) {
        case 'giscus':
          return new engine.hb.SafeString(renderGiscusComments(cfg, hashAttrs));
        case 'utterances':
          return new engine.hb.SafeString(renderUtterancesComments(cfg, hashAttrs));
        case 'disqus':
          return new engine.hb.SafeString(
            renderDisqusComments(cfg, canonical, identifier, nonce, hashAttrs),
          );
        case 'webmention.io':
          return new engine.hb.SafeString(renderWebmentionComments(cfg, canonical, hashAttrs));
        default:
          return new engine.hb.SafeString(renderCommentsContainer(hashAttrs));
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
        `<form data-members-form="subscribe" data-nectar-subscribe action="#" method="post"><input data-members-email type="email" name="email" required placeholder="${escapeAttr(placeholder)}"><input data-members-label type="hidden" value="${escapeAttr(label)}"><button data-members-submit type="submit"><span>${escapeHtml(buttonText)}</span></button></form>`,
      );
    },
  );

  engine.hb.registerHelper('action', function actionHelper() {
    return '#';
  });

  engine.hb.registerHelper(
    'hidden',
    function hiddenHelper(this: unknown, options?: Handlebars.HelperOptions) {
      const label = options?.hash?.label != null ? String(options.hash.label) : '';
      return new engine.hb.SafeString(
        `<input data-members-label type="hidden" value="${escapeAttr(label)}">`,
      );
    },
  );

  engine.hb.registerHelper('script', function scriptHelper() {
    return new engine.hb.SafeString('');
  });

  engine.hb.registerHelper(
    'input_email',
    function inputEmailHelper(this: unknown, options: Handlebars.HelperOptions) {
      const placeholder = String(options.hash.placeholder ?? 'Your email address');
      // `name="email"` is included by default so the bare input is a valid
      // form field even when the surrounding form is not rewritten by an
      // adapter. Provider adapters overwrite the attribute downstream when
      // they need a non-default field name (e.g. Mailchimp wants `EMAIL`).
      return new engine.hb.SafeString(
        `<input${inputEmailExtraAttrs(options.hash, 'gh-input')} data-members-email type="email" name="email" required placeholder="${escapeAttr(placeholder)}">`,
      );
    },
  );

  engine.hb.registerHelper(
    'input_password',
    function inputPasswordHelper(this: unknown, options: Handlebars.HelperOptions) {
      const placeholder = String(options.hash.placeholder ?? 'Password');
      return new engine.hb.SafeString(
        `<input class="gh-input" data-members-password type="password" name="password" required placeholder="${escapeAttr(placeholder)}">`,
      );
    },
  );

  engine.hb.registerHelper('search', function searchHelper() {
    return new engine.hb.SafeString(renderDefaultSearchPartial(engine));
  });

  engine.hb.registerHelper('meta_data', function metaDataHelper() {
    return new engine.hb.SafeString('');
  });

  engine.hb.registerHelper('post_class', function postClassHelper(this: unknown) {
    const ctx = this as {
      tags?: { slug: string }[];
      featured?: boolean;
      feature_image?: string | undefined;
      html?: string;
      page?: boolean;
      visibility?: 'public' | 'members' | 'paid' | 'tiers' | 'filter';
    };
    return computePostClass(ctx);
  });

  engine.hb.registerHelper(
    'body_class',
    function bodyClassHelper(this: unknown, options: Handlebars.HelperOptions) {
      const route = options.data?.route as { kind?: string } | undefined;
      const ctx = this as { body_class?: string; tags?: { slug?: unknown }[] };
      if (ctx.body_class !== undefined) return ctx.body_class;
      const tokens = route?.kind ? [`nectar-route-${route.kind}`] : [];
      if (route?.kind === 'post') {
        const seen = new Set(tokens);
        for (const tag of ctx.tags ?? []) {
          if (typeof tag.slug !== 'string' || tag.slug.length === 0) continue;
          const token = `tag-${tag.slug}`;
          if (seen.has(token)) continue;
          seen.add(token);
          tokens.push(token);
        }
      }
      return tokens.join(' ');
    },
  );
}

function truncateWords(html: string, words: number, locale: string | undefined): string {
  if (!html || words <= 0) return '';
  const doc = parseDocument(html, {
    decodeEntities: false,
    lowerCaseAttributeNames: false,
  });
  const state = { remaining: words, locale, done: false };
  truncateWordNodes(doc.children, state);
  return state.done ? renderHtml(doc.children, { decodeEntities: false }) : html;
}

type HtmlWordTruncateState = {
  remaining: number;
  locale: string | undefined;
  done: boolean;
};

function truncateWordNodes(nodes: ChildNode[], state: HtmlWordTruncateState): void {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!node) continue;
    if (state.done) {
      nodes.splice(i);
      relinkSiblings(nodes);
      return;
    }
    if (isElement(node)) {
      truncateWordNodes(node.children, state);
      if (state.done) {
        nodes.splice(i + 1);
        relinkSiblings(node.children);
        relinkSiblings(nodes);
        return;
      }
      continue;
    }
    if (node.type !== 'text') continue;

    const truncated = truncateTextNodeByWords(node.data, state.remaining, state.locale);
    node.data = truncated.text;
    state.remaining -= truncated.words;
    state.done = truncated.limitReached;
  }
}

function truncateTextNodeByWords(
  text: string,
  words: number,
  locale: string | undefined,
): { text: string; words: number; limitReached: boolean } {
  if (!text || words <= 0) return { text: '', words: 0, limitReached: true };
  const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
  let count = 0;
  let end = 0;
  for (const seg of segmenter.segment(text)) {
    if (!seg.isWordLike) continue;
    count += 1;
    end = seg.index + seg.segment.length;
    if (count >= words) {
      return { text: text.slice(0, end), words: count, limitReached: true };
    }
  }
  return { text, words: count, limitReached: false };
}

function isElement(node: ChildNode): node is Element {
  return 'attribs' in node && 'children' in node;
}

function relinkSiblings(nodes: ChildNode[]): void {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!node) continue;
    node.prev = nodes[i - 1] ?? null;
    node.next = nodes[i + 1] ?? null;
  }
}

function siteLocale(options: Handlebars.HelperOptions): string | undefined {
  const site = options.data?.site as { locale?: unknown } | undefined;
  return typeof site?.locale === 'string' ? site.locale : undefined;
}

function inputEmailExtraAttrs(hash: Record<string, unknown>, baseClass?: string): string {
  const attrs: string[] = [];
  const classes = [baseClass, typeof hash.class === 'string' ? hash.class : undefined]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ');
  if (classes) attrs.push(`class="${escapeAttr(classes)}"`);
  pushBooleanAttr(attrs, 'autofocus', hash.autofocus);
  for (const name of ['autocomplete', 'id', 'aria-label']) {
    const value = hash[name];
    if (typeof value === 'string' && value.length > 0) {
      attrs.push(`${name}="${escapeAttr(value)}"`);
    }
  }
  return attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
}

function pushBooleanAttr(attrs: string[], name: string, value: unknown): void {
  if (value === true || value === name || value === 'true') {
    attrs.push(name);
  }
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

function truncateCharactersAtWordBoundary(text: string, characters: number): string {
  const sliced = sliceByCharacters(text, characters).trimEnd();
  if (sliced.length === 0 || sliced.length === text.length) return sliced;
  const lastWhitespace = sliced.search(/\s+\S*$/);
  if (lastWhitespace <= 0) return sliced;
  return sliced.slice(0, lastWhitespace).trimEnd();
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
  /<div class="gh-paywall-stub" data-paywall-visibility="(members|paid|tiers|filter)">[\s\S]*?<\/div>/g;

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

function isPublicVisibility(ctx: Record<string, unknown>): boolean {
  return typeof ctx.visibility !== 'string' || ctx.visibility === 'public';
}

function publicSafeExcerpt(ctx: Record<string, unknown>): string {
  const customExcerpt =
    typeof ctx.custom_excerpt === 'string' && ctx.custom_excerpt.length > 0
      ? ctx.custom_excerpt
      : '';
  if (!isPublicVisibility(ctx)) return customExcerpt;
  return (
    customExcerpt ||
    (typeof ctx.excerpt === 'string' ? ctx.excerpt : '') ||
    (typeof ctx.plaintext === 'string' ? ctx.plaintext : '')
  );
}

export function publicSafeGeneratedExcerpt(ctx: Record<string, unknown>): string {
  if (!isPublicVisibility(ctx)) return '';
  return typeof ctx.excerpt === 'string' ? ctx.excerpt : '';
}

function publicSafeFirstSentence(ctx: Record<string, unknown>): string {
  if (!isPublicVisibility(ctx)) return '';
  return firstSentence(ctx.plaintext);
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

function translate(engine: NectarEngine, options: Handlebars.HelperOptions, key: string): string {
  const route = options.data?.route as { locale?: unknown } | undefined;
  const locale =
    typeof route?.locale === 'string' ? route.locale : (engine.content.site?.locale ?? 'en');
  const active = engine.theme.locales?.[locale] ?? {};
  const fallback = engine.theme.locales?.en ?? {};
  const value = active[key] ?? fallback[key];
  return typeof value === 'string' ? value : key;
}

function renderDefaultSearchPartial(engine: NectarEngine): string {
  const partial = engine.hb.partials.search;
  if (typeof partial === 'function') {
    return partial({}, { data: {} });
  }
  const source = typeof partial === 'string' ? partial : (DEFAULT_PARTIALS.search ?? '');
  return source
    .replaceAll('{{t "Search"}}', 'Search')
    .replaceAll('{{t "Search posts…"}}', 'Search posts...');
}

function hashString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isHandlebarsSafeString(value)) return value.toHTML();
  return undefined;
}

function isHandlebarsSafeString(value: unknown): value is { toHTML(): string } {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as { toHTML?: unknown }).toHTML === 'function';
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

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function routeScopedMetaTitle(
  ctx: Record<string, unknown>,
  route: { kind?: string; data?: Record<string, unknown> },
): string | undefined {
  if (route.kind === 'tag') {
    const tagFromCtx = recordValue(ctx.tag);
    if (tagFromCtx) {
      return firstNonEmptyString(
        tagFromCtx.meta_title,
        tagFromCtx.og_title,
        tagFromCtx.twitter_title,
        ctx.meta_title,
        tagFromCtx.name,
      );
    }
    if (firstNonEmptyString(ctx.meta_title, ctx.title)) return undefined;
    const tag = recordValue(route.data?.tag);
    return firstNonEmptyString(tag?.meta_title, tag?.og_title, tag?.twitter_title, tag?.name);
  }
  if (route.kind === 'author') {
    const authorFromCtx = recordValue(ctx.author);
    if (authorFromCtx) {
      return firstNonEmptyString(authorFromCtx.meta_title, ctx.meta_title, authorFromCtx.name);
    }
    if (firstNonEmptyString(ctx.meta_title, ctx.title)) return undefined;
    const author = recordValue(route.data?.author);
    return firstNonEmptyString(author?.meta_title, author?.name);
  }
  return undefined;
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

function commentsHashAttrs(hash: Record<string, unknown>): [string, string][] {
  const attrs: [string, string][] = [];
  if (Object.hasOwn(hash, 'title')) attrs.push(['data-comments-title', String(hash.title ?? '')]);
  if (Object.hasOwn(hash, 'count')) attrs.push(['data-comments-count', String(hash.count ?? '')]);
  return attrs;
}

function renderCommentsContainer(attrs: [string, string][] = []): string {
  const rendered = renderAttrList([
    ['id', 'ghost-comments-root'],
    ['class', 'gh-comments'],
    ['data-ghost-comments', null],
    ...attrs,
  ]);
  return `<div ${rendered}></div>`;
}

function renderGiscusComments(
  cfg: CommentsConfig,
  containerAttrs: [string, string][] = [],
): string {
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
  return `${renderCommentsContainer(containerAttrs)}\n<script ${rendered} async></script>`;
}

function renderUtterancesComments(
  cfg: CommentsConfig,
  containerAttrs: [string, string][] = [],
): string {
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
  return `${renderCommentsContainer(containerAttrs)}\n<script ${rendered} async></script>`;
}

function renderDisqusComments(
  cfg: CommentsConfig,
  canonical: string,
  identifier: string,
  cspNonce: string | undefined,
  containerAttrs: [string, string][] = [],
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
    renderCommentsContainerWithId('disqus_thread', containerAttrs),
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

function renderCommentsContainerWithId(id: string, attrs: [string, string][] = []): string {
  const rendered = renderAttrList([
    ['id', id],
    ['class', 'gh-comments'],
    ['data-ghost-comments', null],
    ...attrs,
  ]);
  return `<div ${rendered}></div>`;
}

function renderWebmentionComments(
  cfg: CommentsConfig,
  canonical: string,
  containerAttrs: [string, string][] = [],
): string {
  const parts = [
    'class="webmentions"',
    'data-ghost-comments',
    ...containerAttrs.map(([k, v]) => `${k}="${escapeAttr(v)}"`),
    'data-nectar-webmentions',
    `data-target="${escapeAttr(canonical)}"`,
  ];
  if (cfg.username) parts.push(`data-username="${escapeAttr(cfg.username)}"`);
  return `<div ${parts.join(' ')}></div>`;
}

function renderAttrList(attrs: [string, string | null][]): string {
  return attrs.map(([k, v]) => (v === null ? k : `${k}="${escapeAttr(v)}"`)).join(' ');
}

function buildCanonicalUrl(base: string | undefined, path: string): string {
  if (!base) return path;
  if (/^https?:/i.test(path)) return path;
  if (URL_SCHEME_RE.test(path)) return base;
  try {
    return new URL(path, base.endsWith('/') ? base : `${base}/`).toString();
  } catch {
    return path;
  }
}

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function renderTagListItem(
  tag: { name: string; url?: string },
  autolink: boolean,
  cache: WeakMap<
    { name: string; url?: string },
    { name: string; url: string | undefined; escapedName: string; linkedHtml: string | undefined }
  >,
  engine: NectarEngine,
): string {
  let cached = cache.get(tag);
  if (!cached || cached.name !== tag.name || cached.url !== tag.url) {
    const escapedName = escapeHtml(tag.name);
    const linkedHtml =
      typeof tag.url === 'string' && tag.url.length > 0
        ? `<a href="${engine.hb.escapeExpression(sanitizeHref(tag.url, '{{tags}} helper'))}">${escapedName}</a>`
        : undefined;
    cached = { name: tag.name, url: tag.url, escapedName, linkedHtml };
    cache.set(tag, cached);
  }
  if (!autolink || !cached.linkedHtml) return cached.escapedName;
  return cached.linkedHtml;
}

function escapeForScript(json: string): string {
  return json
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/[\u2028\u2029]/g, (c) => (c === '\u2028' ? '\\u2028' : '\\u2029'));
}
