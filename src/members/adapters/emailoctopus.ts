import { NectarError } from '~/util/errors.ts';
import type {
  PortalAdapter,
  ResolvedSubscribeForm,
  SubscribeAdapterConfig,
} from '../portal-adapter.ts';

// EmailOctopus' HTML embed posts to a list-scoped public endpoint. The email
// input is `field_0`; first name is conventionally `field_1`.
export const emailOctopusAdapter: PortalAdapter = {
  provider: 'emailoctopus',
  resolve(cfg: SubscribeAdapterConfig): ResolvedSubscribeForm {
    const action = cfg.action ?? actionFromListId(cfg.list_id);
    if (!action) {
      throw new NectarError({
        message:
          'components.subscribe.action or list_id is required when provider is "emailoctopus"',
        hint: 'Set components.subscribe.list_id to your EmailOctopus list id, or paste the full embedded form action into components.subscribe.action',
        code: 'config',
      });
    }
    return {
      action,
      emailFieldName: cfg.field_map?.email ?? cfg.email_field_name ?? 'field_0',
      nameFieldName: cfg.field_map?.name ?? cfg.name_field_name ?? 'field_1',
      method: cfg.method ?? 'post',
      disabled: false,
    };
  },
};

function actionFromListId(listId: string | undefined): string | undefined {
  const trimmed = listId?.trim();
  if (!trimmed) return undefined;
  return `https://emailoctopus.com/lists/${encodeURIComponent(trimmed)}/members/embedded/1.3/add`;
}
