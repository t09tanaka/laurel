import { LaurelError } from '~/util/errors.ts';
import type {
  PortalAdapter,
  ResolvedSubscribeForm,
  SubscribeAdapterConfig,
} from '../portal-adapter.ts';

// listmonk's public subscription endpoint accepts browser form posts without
// API credentials. The list UUID is submitted as `l`, matching listmonk's
// form-encoded public API contract.
export const listmonkAdapter: PortalAdapter = {
  provider: 'listmonk',
  resolve(cfg: SubscribeAdapterConfig): ResolvedSubscribeForm {
    if (!cfg.action) {
      throw new LaurelError({
        message: 'components.subscribe.action is required when provider is "listmonk"',
        hint: 'Set components.subscribe.action to your listmonk public subscription endpoint, e.g. https://lists.example.com/api/public/subscription',
        code: 'config',
      });
    }
    const listIds = normaliseListIds(cfg);
    if (listIds.length === 0) {
      throw new LaurelError({
        message: 'components.subscribe.list_id is required when provider is "listmonk"',
        hint: 'Set components.subscribe.list_id to the public list UUID, or list_ids for multiple list UUIDs',
        code: 'config',
      });
    }
    return {
      action: cfg.action,
      emailFieldName: cfg.field_map?.email ?? cfg.email_field_name ?? 'email',
      nameFieldName: cfg.field_map?.name ?? cfg.name_field_name ?? 'name',
      method: cfg.method ?? 'post',
      disabled: false,
      hiddenFields: listIds.map((id) => ({ name: 'l', value: id })),
    };
  },
};

function normaliseListIds(cfg: SubscribeAdapterConfig): string[] {
  const values = [...(cfg.list_ids ?? []), cfg.list_id ?? ''];
  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}
