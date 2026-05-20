import { NectarError } from '~/util/errors.ts';
import type {
  PortalAdapter,
  ResolvedSubscribeForm,
  SubscribeAdapterConfig,
} from '../portal-adapter.ts';

// Kit still accepts browser POSTs to its hosted form subscription endpoint.
// This keeps Nectar static: operators provide only the form id, never an API key.
export const convertkitAdapter: PortalAdapter = {
  provider: 'convertkit',
  resolve(cfg: SubscribeAdapterConfig): ResolvedSubscribeForm {
    const formId = cfg.form_id ?? cfg.publication_id ?? cfg.username;
    if (!formId) {
      throw new NectarError({
        message: 'components.subscribe.form_id is required when provider is "convertkit"',
        hint: 'Set components.subscribe.form_id in nectar.toml to your Kit / ConvertKit form id',
        code: 'config',
      });
    }
    return {
      action: cfg.action ?? `https://app.kit.com/forms/${encodeURIComponent(formId)}/subscriptions`,
      emailFieldName: cfg.field_map?.email ?? cfg.email_field_name ?? 'email_address',
      nameFieldName: cfg.field_map?.name ?? cfg.name_field_name ?? 'fields[first_name]',
      method: cfg.method ?? 'post',
      disabled: false,
    };
  },
};
