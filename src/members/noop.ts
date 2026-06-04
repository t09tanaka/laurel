export const SUBSCRIBE_NOOP_REASON = 'subscribe-provider-none';

export const SUBSCRIBE_NOOP_BUILD_WARNING =
  '[components.subscribe].provider is none; signup forms are no-ops in static output. Configure a subscribe provider or strip the signup CTA.';

export const SUBSCRIBE_NOOP_RUNTIME_WARNING =
  'Laurel signup form is disabled because components.subscribe.provider is none; configure a subscribe provider to enable submissions.';

export function subscribeNoopSubmitHandler(): string {
  return `event.preventDefault();if(window.console&&window.console.warn){window.console.warn('${SUBSCRIBE_NOOP_RUNTIME_WARNING}');}return false;`;
}
