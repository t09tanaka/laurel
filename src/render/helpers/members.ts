import type Handlebars from 'handlebars';
import type { Tier } from '~/content/model.ts';
import { type SubscribeAdapterConfig, resolveSubscribeAdapter } from '~/members/index.ts';
import type { NectarEngine } from '../engine.ts';

export function registerMemberHelpers(engine: NectarEngine): void {
  engine.hb.registerHelper(
    'cancel_link',
    function cancelLinkHelper(this: unknown, options: Handlebars.HelperOptions) {
      const subscription = this as { id?: unknown; cancel_at_period_end?: unknown } | undefined;
      if (subscription?.id === undefined || subscription.cancel_at_period_end === undefined) {
        return new engine.hb.SafeString('');
      }

      const hash = options.hash as Record<string, unknown>;
      const cls = pickString(hash.class, 'gh-subscription-cancel');
      const errorClass = pickString(hash.errorClass, 'gh-error gh-error-subscription-cancel');
      const cancelLabel = pickString(hash.cancelLabel, 'Cancel subscription');
      const continueLabel = pickString(hash.continueLabel, 'Resume subscription');
      const id = String(subscription.id);
      const continuing = toBoolean(subscription.cancel_at_period_end);
      const dataAttr = continuing
        ? `data-members-continue-subscription="${escapeAttr(id)}"`
        : `data-members-cancel-subscription="${escapeAttr(id)}"`;
      const label = continuing ? continueLabel : cancelLabel;

      return new engine.hb.SafeString(
        `<a class="${escapeAttr(cls)}" ${dataAttr} href="javascript:">${escapeHtml(label)}</a>` +
          `<span class="${escapeAttr(errorClass)}" data-members-error><!-- error message will appear here --></span>`,
      );
    },
  );

  engine.hb.registerHelper(
    'member_count',
    function memberCountHelper(this: unknown, options: Handlebars.HelperOptions) {
      const hash = options.hash as Record<string, unknown>;
      const paidOnly = toBoolean(hash.paid) || pickString(hash.type, '') === 'paid';
      const count = resolveMemberCount(this, options.data?.site, paidOnly);
      return new engine.hb.SafeString(formatMemberCount(count));
    },
  );

  engine.hb.registerHelper(
    'signup',
    function signupHelper(this: unknown, options: Handlebars.HelperOptions) {
      const resolved = resolveSubscribeAdapter(
        engine.config.components.subscribe as SubscribeAdapterConfig,
      );
      const hash = options.hash as Record<string, unknown>;
      const formClass = pickString(hash.class ?? hash.formClass, 'gh-signup-form');
      const inputClass = pickString(hash.inputClass, 'gh-signup-input');
      const buttonClass = pickString(hash.buttonClass, 'gh-signup-button');
      const placeholder = pickString(hash.placeholder, 'Email address');
      const buttonText = pickString(hash.buttonText ?? hash.label, 'Subscribe');
      const includeName = toBoolean(hash.name);
      const disabledAttr = resolved.disabled
        ? ' onsubmit="event.preventDefault();return false;"'
        : '';
      const nameInput = includeName
        ? `<input class="${escapeAttr(inputClass)}" type="text" name="${escapeAttr(
            resolved.nameFieldName,
          )}" autocomplete="name" data-members-name>`
        : '';
      const body = options.fn
        ? options.fn(this)
        : `${nameInput}<input class="${escapeAttr(inputClass)}" type="email" name="${escapeAttr(
            resolved.emailFieldName,
          )}" placeholder="${escapeAttr(
            placeholder,
          )}" autocomplete="email" required data-members-email><button class="${escapeAttr(
            buttonClass,
          )}" type="submit" data-members-submit>${escapeHtml(buttonText)}</button>`;

      return new engine.hb.SafeString(
        `<form class="${escapeAttr(formClass)}" data-members-form="signup" action="${escapeAttr(
          resolved.action,
        )}" method="${escapeAttr(resolved.method)}"${disabledAttr}>${body}</form>`,
      );
    },
  );

  engine.hb.registerHelper('tiers', function tiersHelper(this: unknown, options = {}) {
    const helperOptions = options as Handlebars.HelperOptions;
    const hash = (helperOptions.hash ?? {}) as Record<string, unknown>;
    const selected = resolveTierList(this, engine, hash);
    const names = selected.map(tierName).filter((name): name is string => name !== undefined);
    if (names.length === 0) return new engine.hb.SafeString('');

    const separator = pickString(hash.separator, ', ');
    const lastSeparator = pickString(hash.lastSeparator, ' and ');
    const prefix = pickString(hash.prefix, '');
    const suffix =
      typeof hash.suffix === 'string' ? hash.suffix : names.length === 1 ? ' tier' : ' tiers';
    const escapedNames = names.map(escapeHtml);
    const joined =
      escapedNames.length === 1
        ? escapedNames[0]
        : `${escapedNames.slice(0, -1).join(escapeHtml(separator))}${escapeHtml(
            lastSeparator,
          )}${escapedNames.at(-1)}`;

    return new engine.hb.SafeString(`${escapeHtml(prefix)}${joined}${escapeHtml(suffix)}`);
  });
}

function resolveTierList(
  ctx: unknown,
  engine: NectarEngine,
  hash: Record<string, unknown>,
): readonly unknown[] {
  const contextTiers = readContextTiers(ctx);
  if (contextTiers) return contextTiers;
  if (toBoolean(hash.all) || pickString(hash.source, '') === 'site') return engine.content.tiers;
  return isPostOrPageLike(ctx) ? [] : engine.content.tiers;
}

function readContextTiers(ctx: unknown): readonly unknown[] | undefined {
  if (Array.isArray(ctx)) return ctx;
  if (!ctx || typeof ctx !== 'object') return undefined;
  const tiers = (ctx as { tiers?: unknown }).tiers;
  return Array.isArray(tiers) ? tiers : undefined;
}

function tierName(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  const name = (value as Pick<Tier, 'name'>).name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

function isPostOrPageLike(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.id === 'string' && (typeof obj.title === 'string' || 'visibility' in obj);
}

function resolveMemberCount(ctx: unknown, site: unknown, paidOnly: boolean): number {
  const sources = [ctx, site];
  const keys = paidOnly
    ? ['paid', 'paid_members', 'paid_member_count', 'total_paid_members']
    : ['total', 'members', 'member_count', 'members_count', 'total_members'];
  for (const source of sources) {
    const count = readFirstNumeric(source, keys);
    if (count !== undefined) return count;
  }
  return 0;
}

function readFirstNumeric(source: unknown, keys: readonly string[]): number | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const obj = source as Record<string, unknown>;
  for (const key of keys) {
    const n = toNonNegativeInteger(obj[key]);
    if (n !== undefined) return n;
  }
  const count = obj.count;
  if (count && typeof count === 'object') {
    return readFirstNumeric(count, keys);
  }
  return undefined;
}

function toNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return undefined;
}

function formatMemberCount(count: number): string {
  if (count <= 50) return count.toLocaleString('en');
  if (count <= 100) return `${roundDown(count, 10).toLocaleString('en')}+`;
  if (count <= 1000) return `${roundDown(count, 50).toLocaleString('en')}+`;
  if (count <= 10000) return `${roundDown(count, 100).toLocaleString('en')}+`;
  if (count <= 100000) return `${roundDown(count, 1000).toLocaleString('en')}+`;
  return `${roundDown(count, 10000).toLocaleString('en')}+`;
}

function roundDown(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function toBoolean(value: unknown): boolean {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    return lower === 'true' || lower === '1' || lower === 'yes';
  }
  return Boolean(value);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
