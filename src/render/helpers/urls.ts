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
  engine.hb.registerHelper(
    'url',
    function urlHelper(this: unknown, options: Handlebars.HelperOptions) {
      const ctx = this as { url?: string };
      const absolute = options.hash.absolute === true || options.hash.absolute === 'true';
      if (!ctx.url) return '';
      if (!absolute) return ctx.url;
      try {
        return new URL(ctx.url, engine.content.site.url).toString();
      } catch {
        return ctx.url;
      }
    },
  );

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
    const [user, host] = clean.split('@');
    return `https://${host}/@${user}`;
  }
  return `https://mastodon.social/@${clean}`;
}
