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
  method?: 'get' | 'post' | undefined;
  username?: string | undefined;
  publication_id?: string | undefined;
  form_id?: string | undefined;
  email_field_name?: string | undefined;
  name_field_name?: string | undefined;
  field_map?: Record<string, string> | undefined;
  strip_selectors?: ReadonlyArray<string> | undefined;
}

export function resolveSubscribeForm(cfg: SubscribeFormConfig): ResolvedSubscribeForm {
  return resolveSubscribeAdapter(cfg as SubscribeAdapterConfig);
}

const FORM_BLOCK_RE = /<form\b[^>]*\bdata-members-form\b[^>]*>[\s\S]*?<\/form>/gi;
const FORM_OPEN_RE = /^<form\b[^>]*>/i;
const INPUT_RE = /<input\b[^>]*>/gi;
const BUTTON_RE = /<button\b[^>]*>/gi;

export function transformSubscribeForms(html: string, cfg: SubscribeFormConfig): string {
  // Adapter-specific whole-document rewrites run first so e.g. `none`'s
  // wrapper-strip happens before we try to patch attributes on forms that
  // are no longer there.
  let out = runAdapterTransform(html, cfg as SubscribeAdapterConfig);

  if (!out.includes('data-members-form') && !out.includes('data-members-email')) {
    return out;
  }
  const resolved = getAdapter(cfg.provider).resolve(cfg as SubscribeAdapterConfig);

  out = out.replace(FORM_BLOCK_RE, (block) => rewriteMembersFormBlock(block, resolved));

  return out;
}

function rewriteMembersFormBlock(block: string, resolved: ResolvedSubscribeForm): string {
  const open = block.match(FORM_OPEN_RE)?.[0];
  if (!open) return block;
  const body = block.slice(open.length);
  let form = setAttribute(open, 'action', resolved.action);
  form = setAttribute(form, 'method', resolved.method);
  form = resolved.disabled
    ? setAttribute(form, 'onsubmit', 'event.preventDefault();return false;')
    : removeAttribute(form, 'onsubmit');

  const rewrittenBody = body
    .replace(INPUT_RE, (tag) => rewriteMembersInput(tag, resolved))
    .replace(BUTTON_RE, (tag) => rewriteMembersButton(tag));
  return `${form}${rewrittenBody}`;
}

function rewriteMembersInput(tag: string, resolved: ResolvedSubscribeForm): string {
  if (hasAttribute(tag, 'data-members-name')) {
    return setAttribute(tag, 'name', resolved.nameFieldName);
  }
  if (
    hasAttribute(tag, 'data-members-email') ||
    getAttribute(tag, 'type')?.toLowerCase() === 'email'
  ) {
    const hooked = hasAttribute(tag, 'data-members-email')
      ? tag
      : setBooleanAttribute(tag, 'data-members-email');
    return setAttribute(hooked, 'name', resolved.emailFieldName);
  }
  return tag;
}

function rewriteMembersButton(tag: string): string {
  const type = getAttribute(tag, 'type')?.toLowerCase();
  if (type && type !== 'submit') return tag;
  return hasAttribute(tag, 'data-members-submit')
    ? tag
    : setBooleanAttribute(tag, 'data-members-submit');
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

function setBooleanAttribute(tag: string, attr: string): string {
  if (hasAttribute(tag, attr)) return tag;
  return tag.replace(/(\s*\/?>)$/, ` ${attr}$1`);
}

function hasAttribute(tag: string, attr: string): boolean {
  const re = new RegExp(`\\s${attr}(?:\\s*=|\\s|/?>)`, 'i');
  return re.test(tag);
}

function getAttribute(tag: string, attr: string): string | undefined {
  const re = new RegExp(`\\s${attr}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  const match = tag.match(re);
  const raw = match?.[1];
  if (!raw) return undefined;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
