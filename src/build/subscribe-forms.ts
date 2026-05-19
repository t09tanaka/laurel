import { NectarError } from '~/util/errors.ts';

export interface SubscribeFormConfig {
  provider: 'none' | 'buttondown' | 'mailchimp' | 'custom';
  action?: string | undefined;
  username?: string | undefined;
  email_field_name?: string | undefined;
}

interface Resolved {
  action: string;
  emailFieldName: string;
  disabled: boolean;
}

export function resolveSubscribeForm(cfg: SubscribeFormConfig): Resolved {
  switch (cfg.provider) {
    case 'none':
      return {
        action: '#',
        emailFieldName: cfg.email_field_name ?? 'email',
        disabled: true,
      };
    case 'buttondown': {
      if (!cfg.username) {
        throw new NectarError({
          message: 'components.subscribe.username is required when provider is "buttondown"',
          hint: 'Set components.subscribe.username in nectar.toml to your Buttondown username',
        });
      }
      return {
        action: `https://buttondown.email/api/emails/embed-subscribe/${encodeURIComponent(cfg.username)}`,
        emailFieldName: cfg.email_field_name ?? 'email',
        disabled: false,
      };
    }
    case 'mailchimp': {
      if (!cfg.action) {
        throw new NectarError({
          message: 'components.subscribe.action is required when provider is "mailchimp"',
          hint: 'Set components.subscribe.action in nectar.toml to your Mailchimp list URL',
        });
      }
      return {
        action: cfg.action,
        emailFieldName: cfg.email_field_name ?? 'EMAIL',
        disabled: false,
      };
    }
    case 'custom': {
      if (!cfg.action) {
        throw new NectarError({
          message: 'components.subscribe.action is required when provider is "custom"',
          hint: 'Set components.subscribe.action in nectar.toml to the form endpoint URL',
        });
      }
      return {
        action: cfg.action,
        emailFieldName: cfg.email_field_name ?? 'email',
        disabled: false,
      };
    }
  }
}

const FORM_RE = /<form\b([^>]*?)\bdata-members-form\b([^>]*)>/gi;
const EMAIL_INPUT_RE = /<input\b([^>]*?)\bdata-members-email\b([^>]*)>/gi;

export function transformSubscribeForms(html: string, cfg: SubscribeFormConfig): string {
  if (!html.includes('data-members-form') && !html.includes('data-members-email')) {
    return html;
  }
  const resolved = resolveSubscribeForm(cfg);

  let out = html.replace(FORM_RE, (tag) => {
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
