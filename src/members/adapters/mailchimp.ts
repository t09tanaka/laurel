import { NectarError } from '~/util/errors.ts';
import type {
  PortalAdapter,
  ResolvedSubscribeForm,
  SubscribeAdapterConfig,
} from '../portal-adapter.ts';

// Mailchimp's embedded form requires the operator-specific `subscribe/post`
// URL containing both the audience id (`u=`) and list id (`id=`). We do not
// try to construct it from credentials — the dashboard exposes the full
// action verbatim and operators paste it into `components.subscribe.action`.
//
// Mailchimp expects the email field to be `EMAIL` (uppercase). Operators
// may override via `email_field_name` if they front the URL with a proxy
// that renames fields.
export const mailchimpAdapter: PortalAdapter = {
  provider: 'mailchimp',
  resolve(cfg: SubscribeAdapterConfig): ResolvedSubscribeForm {
    if (!cfg.action) {
      throw new NectarError({
        message: 'components.subscribe.action is required when provider is "mailchimp"',
        hint: 'Set components.subscribe.action in nectar.toml to your Mailchimp list URL',
        code: 'config',
      });
    }
    return {
      action: cfg.action,
      emailFieldName: cfg.email_field_name ?? 'EMAIL',
      disabled: false,
    };
  },
};
