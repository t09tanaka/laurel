import type Handlebars from 'handlebars';
import type { NectarEngine } from '../engine.ts';

export function registerContentHelpers(engine: NectarEngine): void {
  engine.hb.registerHelper('content', function contentHelper(
    this: unknown,
    options: Handlebars.HelperOptions,
  ) {
    const ctx = this as Record<string, unknown>;
    const html = typeof ctx.html === 'string' ? ctx.html : '';
    const words = options.hash.words;
    if (typeof words === 'number') {
      return new engine.hb.SafeString(truncateWords(html, words));
    }
    return new engine.hb.SafeString(html);
  });

  engine.hb.registerHelper('excerpt', function excerptHelper(
    this: unknown,
    options: Handlebars.HelperOptions,
  ) {
    const ctx = this as Record<string, unknown>;
    const source =
      (typeof ctx.custom_excerpt === 'string' && ctx.custom_excerpt) ||
      (typeof ctx.excerpt === 'string' ? ctx.excerpt : '') ||
      (typeof ctx.plaintext === 'string' ? ctx.plaintext : '');
    const words = parseNum(options.hash.words);
    const characters = parseNum(options.hash.characters);
    if (words) return truncateWordsText(source, words);
    if (characters) return source.slice(0, characters);
    return source;
  });

  engine.hb.registerHelper('reading_time', function readingTimeHelper(
    this: unknown,
    options: Handlebars.HelperOptions,
  ) {
    const ctx = this as Record<string, unknown>;
    const minutes = typeof ctx.reading_time === 'number' ? ctx.reading_time : 1;
    const minute = String(options.hash.minute ?? '1 min read');
    const plural = String(options.hash.minutes ?? '% min read');
    if (minutes <= 1) return minute;
    return plural.replace('%', String(minutes));
  });

  engine.hb.registerHelper('authors', function authorsHelper(
    this: unknown,
    options: Handlebars.HelperOptions,
  ) {
    const ctx = this as { authors?: { name: string }[] };
    const list = ctx.authors ?? [];
    if (options.fn) {
      let out = '';
      for (const author of list) out += options.fn(author);
      return out;
    }
    return list.map((a) => a.name).join(', ');
  });

  engine.hb.registerHelper('tags', function tagsHelper(
    this: unknown,
    options: Handlebars.HelperOptions,
  ) {
    const ctx = this as { tags?: { name: string; slug: string; url: string }[] };
    const list = ctx.tags ?? [];
    const separator = options.hash.separator ?? ', ';
    const autolink = options.hash.autolink !== false;
    if (options.fn) {
      let out = '';
      for (const tag of list) out += options.fn(tag);
      return out;
    }
    const items = list.map((tag) =>
      autolink ? `<a href="${escapeAttr(tag.url)}">${escapeHtml(tag.name)}</a>` : escapeHtml(tag.name),
    );
    return new engine.hb.SafeString(items.join(String(separator)));
  });

  engine.hb.registerHelper('meta_title', function metaTitleHelper(
    this: unknown,
    options: Handlebars.HelperOptions,
  ) {
    const ctx = this as Record<string, unknown>;
    const route = (options.data?.['route'] ?? {}) as { kind?: string; data?: Record<string, unknown> };
    const site = options.data?.['site'] as { title?: string } | undefined;
    const explicit = (ctx.meta_title as string | undefined) || (ctx.title as string | undefined);
    const pageSuffix = String(options.hash.page ?? '');

    if (route.kind === 'post' || route.kind === 'page') {
      return explicit ?? site?.title ?? '';
    }
    const baseTitle = explicit ?? site?.title ?? '';
    const pagination = route.data?.['pagination'] as { page?: number } | undefined;
    if (pagination && pagination.page && pagination.page > 1 && pageSuffix) {
      return `${baseTitle}${pageSuffix.replace('%', String(pagination.page))}`;
    }
    return baseTitle;
  });

  engine.hb.registerHelper('meta_description', function metaDescriptionHelper(
    this: unknown,
    options: Handlebars.HelperOptions,
  ) {
    const ctx = this as Record<string, unknown>;
    const site = options.data?.['site'] as { description?: string } | undefined;
    return (ctx.meta_description as string | undefined)
      ?? (ctx.excerpt as string | undefined)
      ?? site?.description
      ?? '';
  });

  engine.hb.registerHelper('comments', function commentsHelper() {
    return new engine.hb.SafeString('<div data-nectar-comments></div>');
  });

  engine.hb.registerHelper('subscribe_form', function subscribeFormHelper() {
    return new engine.hb.SafeString(
      '<form data-nectar-subscribe action="#" method="post"><input type="email" name="email" /></form>',
    );
  });

  engine.hb.registerHelper('input_email', function inputEmailHelper(this: unknown, options: Handlebars.HelperOptions) {
    const placeholder = String(options.hash.placeholder ?? 'Your email address');
    return new engine.hb.SafeString(
      `<input data-members-email type="email" required placeholder="${escapeAttr(placeholder)}">`,
    );
  });

  engine.hb.registerHelper('post_class', function postClassHelper(this: unknown) {
    const ctx = this as { tags?: { slug: string }[]; featured?: boolean };
    const tokens = ['post'];
    for (const tag of ctx.tags ?? []) tokens.push(`tag-${tag.slug}`);
    if (ctx.featured) tokens.push('featured');
    return tokens.join(' ');
  });

  engine.hb.registerHelper('body_class', function bodyClassHelper(
    this: unknown,
    options: Handlebars.HelperOptions,
  ) {
    const route = options.data?.['route'] as { kind?: string } | undefined;
    const ctx = this as { body_class?: string };
    return ctx.body_class ?? (route?.kind ? `nectar-route-${route.kind}` : '');
  });
}

function truncateWords(html: string, words: number): string {
  const text = html.replace(/<[^>]*>/g, ' ');
  const parts = text.split(/\s+/).filter(Boolean);
  return parts.slice(0, words).join(' ');
}

function truncateWordsText(text: string, words: number): string {
  return text.split(/\s+/).filter(Boolean).slice(0, words).join(' ');
}

function parseNum(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
