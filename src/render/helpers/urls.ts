import type Handlebars from 'handlebars';
import type { NectarEngine } from '../engine.ts';

const SOCIAL_PATTERNS: Record<string, (handle: string) => string> = {
  twitter: (h) => `https://twitter.com/${stripAt(h)}`,
  facebook: (h) => `https://facebook.com/${stripAt(h)}`,
  linkedin: (h) => `https://www.linkedin.com/in/${stripAt(h)}`,
  bluesky: (h) => `https://bsky.app/profile/${stripAt(h)}`,
  mastodon: (h) => normaliseMastodon(h),
  threads: (h) => `https://www.threads.net/@${stripAt(h)}`,
  tiktok: (h) => `https://www.tiktok.com/@${stripAt(h)}`,
  youtube: (h) => `https://www.youtube.com/${stripAt(h)}`,
  instagram: (h) => `https://www.instagram.com/${stripAt(h)}`,
};

const SOCIAL_PLATFORMS = [
  { type: 'x', sourceKey: 'twitter', name: 'X' },
  { type: 'facebook', name: 'Facebook' },
  { type: 'linkedin', name: 'LinkedIn' },
  { type: 'bluesky', name: 'Bluesky' },
  { type: 'threads', name: 'Threads' },
  { type: 'mastodon', name: 'Mastodon' },
  { type: 'tiktok', name: 'TikTok' },
  { type: 'youtube', name: 'YouTube' },
  { type: 'instagram', name: 'Instagram' },
] as const;

interface SocialAccount {
  type: string;
  href: string;
  username: string;
  name: string;
}

export function registerUrlHelpers(engine: NectarEngine): void {
  engine.hb.registerHelper('url', function urlHelper(this: unknown, ...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions;
    // Ghost's {{url}} accepts an optional positional argument so themes can
    // write `{{url "/about/"}}` or `{{url post.url absolute=true}}` instead
    // of having to switch context. When no positional argument is given,
    // fall back to `this.url` (the standard `{{url}}` inside a post block).
    const positional = args.length > 1 ? args[0] : undefined;
    const ctx = this as { url?: string };
    const candidate = typeof positional === 'string' ? positional : ctx.url;
    const absolute = options.hash.absolute === true || options.hash.absolute === 'true';
    const secure = options.hash.secure === true || options.hash.secure === 'true';
    if (!candidate) return '';
    if (!absolute && !secure) return candidate;
    try {
      const resolved = new URL(candidate, engine.content.site.url);
      if (secure) resolved.protocol = 'https:';
      return resolved.toString();
    } catch {
      return candidate;
    }
  });

  engine.hb.registerHelper(
    'social_url',
    function socialUrlHelper(this: unknown, options: Handlebars.HelperOptions) {
      const ctx = this as Record<string, unknown>;
      const type = String(options.hash.type ?? '');
      if (!type) return '';
      const handle = ctx[type];
      if (typeof handle !== 'string' || !handle) return '';
      return buildSocialUrl(type, handle);
    },
  );

  engine.hb.registerHelper('twitter_url', function twitterUrlHelper(handle: unknown) {
    return typeof handle === 'string' && handle ? buildSocialUrl('twitter', handle) : '';
  });

  engine.hb.registerHelper('facebook_url', function facebookUrlHelper(handle: unknown) {
    return typeof handle === 'string' && handle ? buildSocialUrl('facebook', handle) : '';
  });

  engine.hb.registerHelper('readable_url', function readableUrlHelper(...args: unknown[]) {
    const positional = args.length > 1 ? args[0] : undefined;
    const ctx = this as { url?: unknown };
    const candidate = typeof positional === 'string' ? positional : ctx.url;
    return typeof candidate === 'string' ? readableUrl(candidate) : '';
  });

  engine.hb.registerHelper(
    'social_accounts',
    function socialAccountsHelper(this: unknown, ...args: unknown[]) {
      const options = args[args.length - 1] as Handlebars.HelperOptions;
      const source = args.length > 1 ? args[0] : this;
      if (typeof options.fn !== 'function') return '';

      const accounts = buildSocialAccounts(source);
      if (accounts.length === 0) {
        return typeof options.inverse === 'function' ? options.inverse(this) : '';
      }

      let output = '';
      for (let i = 0; i < accounts.length; i += 1) {
        const data = engine.hb.createFrame(
          (options.data as Record<string, unknown> | undefined) ?? {},
        );
        data.index = i;
        data.number = i + 1;
        data.first = i === 0;
        data.last = i === accounts.length - 1;
        data.even = i % 2 === 0;
        data.odd = i % 2 !== 0;
        output += options.fn(accounts[i], { data });
      }
      return output;
    },
  );
}

function stripAt(handle: string): string {
  return handle.replace(/^@/, '');
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function readableUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return stripTrailingSlash(trimmed);
    }
    const hostname = parsed.hostname.replace(/^www\./i, '');
    const host = parsed.port ? `${hostname}:${parsed.port}` : hostname;
    const path = stripTrailingSlash(parsed.pathname);
    return `${host}${path === '/' ? '' : path}${parsed.search}${parsed.hash}`;
  } catch {
    return stripTrailingSlash(trimmed.replace(/^https?:\/\/(?:www\.)?/i, ''));
  }
}

function stripTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

function buildSocialUrl(type: string, handle: string): string {
  if (isAbsoluteHttpUrl(handle)) return handle;
  const builder = SOCIAL_PATTERNS[type];
  if (!builder) return '';
  return builder(handle);
}

function buildSocialAccounts(source: unknown): SocialAccount[] {
  if (!source || typeof source !== 'object') return [];
  const ctx = source as Record<string, unknown>;
  const accounts: SocialAccount[] = [];

  for (const { type, name, sourceKey = type } of SOCIAL_PLATFORMS) {
    const username = ctx[sourceKey];
    if (typeof username !== 'string' || username.length === 0) continue;
    const href = buildSocialUrl(sourceKey, username);
    if (!href) continue;
    accounts.push({ type, name, username, href });
  }

  return accounts;
}

function normaliseMastodon(handle: string): string {
  const clean = handle.replace(/^@/, '');
  if (clean.includes('@')) {
    const parts = clean.split('@');
    if (parts.length !== 2) return '';
    const [user, host] = parts;
    if (!isValidMastodonUser(user) || !isValidHostname(host)) return '';
    return `https://${host}/@${user}`;
  }
  return '';
}

function isValidMastodonUser(user: string): boolean {
  return /^[A-Za-z0-9_]([A-Za-z0-9_.-]{0,28}[A-Za-z0-9_])?$/.test(user);
}

function isValidHostname(host: string): boolean {
  if (!host || host.length > 253) return false;
  const labels = host.split('.');
  if (labels.length < 2) return false;
  const label = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
  return labels.every((l) => label.test(l));
}
