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
      if (isAbsoluteHttpUrl(handle)) return handle;
      const builder = SOCIAL_PATTERNS[type];
      if (!builder) return '';
      return builder(handle);
    },
  );
}

function stripAt(handle: string): string {
  return handle.replace(/^@/, '');
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
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
  if (!isValidMastodonUser(clean)) return '';
  return `https://mastodon.social/@${clean}`;
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
