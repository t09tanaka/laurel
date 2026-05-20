import type Handlebars from 'handlebars';
import type { NectarEngine } from '../engine.ts';

// Ghost themes use {{comment_count}} to render the comment tally for a post
// (e.g. `<span class="post-card-comments">3 comments</span>`). Nectar has no
// members/comments backend, so the count is always 0 at build time. The wrapper
// span carries `data-ghost-comment-count` so an optional client-side script
// (or a future comments provider that surfaces totals) can swap the number in
// without needing to know the theme's class names.
//
// Hash params mirror Ghost's helper:
//   class     — extra classes on the wrapper span (default empty)
//   autowrap  — wrap the text in a span (default true; false emits bare text)
//   empty     — text shown when count is 0 (default falls back to `plural`)
//   singular  — label used when count is 1
//   plural    — label used when count is 0 or N (>= 2) (default empty string)
//
// Ghost themes commonly pass labels (`singular="comment" plural="comments"`)
// and expect the helper to add the number. If a label contains a literal `%`,
// use it as the number placeholder instead.
export function registerCommentCountHelper(engine: NectarEngine): void {
  engine.hb.registerHelper(
    'comment_count',
    function commentCountHelper(this: unknown, options: Handlebars.HelperOptions) {
      const hash = (options?.hash ?? {}) as Record<string, unknown>;
      const ctx = (this ?? {}) as { comment_count?: unknown };
      const count = normalizeCount(ctx.comment_count);

      const singular = pickString(hash.singular);
      const plural = pickString(hash.plural);
      // Ghost falls back to `plural` when `empty` is omitted, so a single
      // hash like `plural="comments"` renders "0 comments" rather than nothing.
      const hasEmpty = hash.empty !== undefined;
      const empty = hasEmpty ? pickString(hash.empty) : plural;

      let text: string;
      if (count === 0) {
        text = hasEmpty ? formatEmpty(empty, count) : formatCountLabel(empty, count);
      } else if (count === 1) {
        text = formatCountLabel(singular, count);
      } else {
        text = formatCountLabel(plural, count);
      }

      if (!shouldAutowrap(hash.autowrap)) {
        return new engine.hb.SafeString(escapeHtml(text));
      }

      const className = pickString(hash.class);
      const classAttr = className.length > 0 ? ` class="${escapeAttr(className)}"` : '';
      return new engine.hb.SafeString(
        `<span${classAttr} data-ghost-comment-count>${escapeHtml(text)}</span>`,
      );
    },
  );
}

function normalizeCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return 0;
}

function pickString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function formatEmpty(template: string, count: number): string {
  if (template.length === 0) return '';
  if (template.includes('%')) return template.replace(/%/g, String(count));
  return template;
}

function formatCountLabel(template: string, count: number): string {
  if (template.length === 0) return '';
  if (template.includes('%')) return template.replace(/%/g, String(count));
  return `${count} ${template}`;
}

function shouldAutowrap(value: unknown): boolean {
  if (value === false) return false;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'false' || lower === '0' || lower === 'no') return false;
  }
  if (value === 0) return false;
  return true;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
