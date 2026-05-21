import { NectarError } from '~/util/errors.ts';
import type {
  PortalAdapter,
  ResolvedSubscribeForm,
  SubscribeAdapterConfig,
} from '../portal-adapter.ts';

// MailerLite embeds expose the full public form action in the generated HTML.
// Operators paste that action verbatim; Nectar only maps Ghost's generic
// members inputs to MailerLite's field names.
export const mailerLiteAdapter: PortalAdapter = {
  provider: 'mailerlite',
  resolve(cfg: SubscribeAdapterConfig): ResolvedSubscribeForm {
    if (!cfg.action) {
      throw new NectarError({
        message: 'components.subscribe.action is required when provider is "mailerlite"',
        hint: 'Set components.subscribe.action in nectar.toml to the action URL from your MailerLite embedded form HTML',
        code: 'config',
      });
    }
    return {
      action: cfg.action,
      emailFieldName: cfg.field_map?.email ?? cfg.email_field_name ?? 'fields[email]',
      nameFieldName: cfg.field_map?.name ?? cfg.name_field_name ?? 'fields[name]',
      method: cfg.method ?? 'post',
      disabled: false,
      hiddenFields: [{ name: 'ml-submit', value: '1' }],
    };
  },
};
