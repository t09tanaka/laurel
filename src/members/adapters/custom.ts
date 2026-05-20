import { NectarError } from '~/util/errors.ts';
import type {
  PortalAdapter,
  ResolvedSubscribeForm,
  SubscribeAdapterConfig,
} from '../portal-adapter.ts';

// `provider = "custom"` lets the operator point the form at any endpoint
// (their own backend, a forwarder, a serverless function). `field_map` is
// the future-proof escape hatch: today only `email` is consulted, but the
// schema accepts arbitrary string -> string pairs so a self-hosted backend
// that expects e.g. `your_email_field` keeps working without a schema bump.
//
// We require `action` because there is no sensible default URL to invent;
// without it the form would POST back to the page and silently fail.
export const customAdapter: PortalAdapter = {
  provider: 'custom',
  resolve(cfg: SubscribeAdapterConfig): ResolvedSubscribeForm {
    if (!cfg.action) {
      throw new NectarError({
        message: 'components.subscribe.action is required when provider is "custom"',
        hint: 'Set components.subscribe.action in nectar.toml to your form endpoint URL',
        code: 'config',
      });
    }
    const mappedEmail = cfg.field_map?.email;
    return {
      action: cfg.action,
      emailFieldName: mappedEmail ?? cfg.email_field_name ?? 'email',
      nameFieldName: cfg.field_map?.name ?? cfg.name_field_name ?? 'name',
      method: cfg.method ?? 'post',
      disabled: false,
    };
  },
};
