import { NectarError } from '~/util/errors.ts';
import type {
  PortalAdapter,
  ResolvedSubscribeForm,
  SubscribeAdapterConfig,
} from '../portal-adapter.ts';

// Beehiiv exposes a public subscription endpoint keyed by publication id:
// `https://api.beehiiv.com/v2/publications/<publication_id>/subscriptions`.
// The form POSTs JSON in production but accepts URL-encoded fallback for
// no-JS browsers. We wire the form action at build time and let an optional
// `data-beehiiv-publication-id` attribute be picked up by a thin client-side
// shim (out of scope for this static rewrite).
//
// `publication_id` is preferred; `username` is accepted as a back-compat
// alias because the portal-urls.ts code path already documented `publication`
// as a generic slug. Operators who only have a slug can still use the portal
// rewrite for `data-portal="signup"` and skip the embed POST.
export const beehiivAdapter: PortalAdapter = {
  provider: 'beehiiv',
  resolve(cfg: SubscribeAdapterConfig): ResolvedSubscribeForm {
    const publicationId = cfg.publication_id ?? cfg.username;
    if (!publicationId) {
      throw new NectarError({
        message: 'components.subscribe.publication_id is required when provider is "beehiiv"',
        hint: 'Set components.subscribe.publication_id in nectar.toml to your Beehiiv publication id (UUID)',
        code: 'config',
      });
    }
    return {
      action: `https://api.beehiiv.com/v2/publications/${encodeURIComponent(publicationId)}/subscriptions`,
      emailFieldName: cfg.email_field_name ?? 'email',
      disabled: false,
    };
  },
};
