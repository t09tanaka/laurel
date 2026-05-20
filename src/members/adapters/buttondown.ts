import { NectarError } from '~/util/errors.ts';
import type {
  PortalAdapter,
  ResolvedSubscribeForm,
  SubscribeAdapterConfig,
} from '../portal-adapter.ts';

// Buttondown ships a documented `embed-subscribe` endpoint keyed by username.
// The form POSTs `email=...` to `https://buttondown.email/api/emails/embed-subscribe/<user>`
// and Buttondown handles confirmation email + redirect. We never collect
// credentials here — the API key stays on the operator's account.
export const buttondownAdapter: PortalAdapter = {
  provider: 'buttondown',
  resolve(cfg: SubscribeAdapterConfig): ResolvedSubscribeForm {
    if (!cfg.username) {
      throw new NectarError({
        message: 'components.subscribe.username is required when provider is "buttondown"',
        hint: 'Set components.subscribe.username in nectar.toml to your Buttondown username',
        code: 'config',
      });
    }
    return {
      action: `https://buttondown.email/api/emails/embed-subscribe/${encodeURIComponent(cfg.username)}`,
      emailFieldName: cfg.email_field_name ?? 'email',
      nameFieldName: cfg.field_map?.name ?? cfg.name_field_name ?? 'name',
      method: cfg.method ?? 'post',
      disabled: false,
    };
  },
};
