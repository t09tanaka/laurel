import { NectarError } from '~/util/errors.ts';
import type {
  PortalAdapter,
  ResolvedSubscribeForm,
  SubscribeAdapterConfig,
} from '../portal-adapter.ts';

// Explicit form-action provider for operators who already have a hosted
// newsletter endpoint. This mirrors `custom` but gives configs a provider name
// that describes the exact integration mode without implying custom runtime JS.
export const customFormActionAdapter: PortalAdapter = {
  provider: 'customformaction',
  resolve(cfg: SubscribeAdapterConfig): ResolvedSubscribeForm {
    if (!cfg.action) {
      throw new NectarError({
        message: 'components.subscribe.action is required when provider is "customformaction"',
        hint: 'Set components.subscribe.action in nectar.toml to the endpoint that should receive the form POST',
        code: 'config',
      });
    }
    return {
      action: cfg.action,
      emailFieldName: cfg.field_map?.email ?? cfg.email_field_name ?? 'email',
      nameFieldName: cfg.field_map?.name ?? cfg.name_field_name ?? 'name',
      method: cfg.method ?? 'post',
      disabled: false,
    };
  },
};
