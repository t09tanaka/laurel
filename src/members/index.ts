import { beehiivAdapter } from './adapters/beehiiv.ts';
import { buttondownAdapter } from './adapters/buttondown.ts';
import { customAdapter } from './adapters/custom.ts';
import { mailchimpAdapter } from './adapters/mailchimp.ts';
import { noneAdapter } from './adapters/none.ts';
import type {
  PortalAdapter,
  ResolvedSubscribeForm,
  SubscribeAdapterConfig,
  SubscribeProvider,
} from './portal-adapter.ts';

export type {
  PortalAdapter,
  ResolvedSubscribeForm,
  SubscribeAdapterConfig,
  SubscribeProvider,
} from './portal-adapter.ts';

// Static registry. Adding a new provider means dropping a file into
// `./adapters/` and registering it here; the schema enum + tests follow.
const ADAPTERS: Readonly<Record<SubscribeProvider, PortalAdapter>> = Object.freeze({
  none: noneAdapter,
  buttondown: buttondownAdapter,
  beehiiv: beehiivAdapter,
  mailchimp: mailchimpAdapter,
  custom: customAdapter,
});

export function getAdapter(provider: SubscribeProvider): PortalAdapter {
  return ADAPTERS[provider];
}

export function resolveSubscribeAdapter(cfg: SubscribeAdapterConfig): ResolvedSubscribeForm {
  return getAdapter(cfg.provider).resolve(cfg);
}

export function runAdapterTransform(html: string, cfg: SubscribeAdapterConfig): string {
  const adapter = getAdapter(cfg.provider);
  return adapter.transform ? adapter.transform(html, cfg) : html;
}
