import {
  type ResolvedSubscribeForm,
  type SubscribeAdapterConfig,
  type SubscribeProvider,
  getAdapter,
  resolveSubscribeAdapter,
  runAdapterTransform,
} from '~/members/index.ts';

// Public config shape consumed by the build pipeline. Stays a plain object
// rather than re-exporting the adapter type so a downstream embedder cannot
// accidentally depend on adapter-internal helpers.
export interface SubscribeFormConfig {
  provider: SubscribeProvider;
  action?: string | undefined;
  username?: string | undefined;
  publication_id?: string | undefined;
  email_field_name?: string | undefined;
  field_map?: Record<string, string> | undefined;
  strip_selectors?: ReadonlyArray<string> | undefined;
}

export function resolveSubscribeForm(cfg: SubscribeFormConfig): ResolvedSubscribeForm {
  return resolveSubscribeAdapter(cfg as SubscribeAdapterConfig);
}

const FORM_RE = /<form\b([^>]*?)\bdata-members-form\b([^>]*)>/gi;
const EMAIL_INPUT_RE = /<input\b([^>]*?)\bdata-members-email\b([^>]*)>/gi;

export function transformSubscribeForms(html: string, cfg: SubscribeFormConfig): string {
  // Adapter-specific whole-document rewrites run first so e.g. `none`'s
  // wrapper-strip happens before we try to patch attributes on forms that
  // are no longer there.
  let out = runAdapterTransform(html, cfg as SubscribeAdapterConfig);

  if (!out.includes('data-members-form') && !out.includes('data-members-email')) {
    return out;
  }
  const resolved = getAdapter(cfg.provider).resolve(cfg as SubscribeAdapterConfig);

  out = out.replace(FORM_RE, (tag) => {
    let next = setAttribute(tag, 'action', resolved.action);
    next = setAttribute(next, 'method', 'post');
    next = resolved.disabled
      ? setAttribute(next, 'onsubmit', 'event.preventDefault();return false;')
      : removeAttribute(next, 'onsubmit');
    return next;
  });

  out = out.replace(EMAIL_INPUT_RE, (tag) => setAttribute(tag, 'name', resolved.emailFieldName));

  return out;
}

function setAttribute(tag: string, attr: string, value: string): string {
  const re = new RegExp(`\\s${attr}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  const escaped = escapeAttr(value);
  if (re.test(tag)) {
    return tag.replace(re, ` ${attr}="${escaped}"`);
  }
  return tag.replace(/(\s*\/?>)$/, ` ${attr}="${escaped}"$1`);
}

function removeAttribute(tag: string, attr: string): string {
  const re = new RegExp(`\\s${attr}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  return tag.replace(re, '');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
