// Portal adapter interface for newsletter / membership backends.
//
// Ghost themes ship dead `data-members-form`, `data-members-email`,
// `data-portal` markers that the runtime Ghost Portal script wires up. Nectar
// is static-only, so each adapter inspects the rendered HTML and rewrites
// those markers to point at the configured backend (or strips them entirely
// when the provider is `none`).
//
// Adapters are pure: they take HTML and config in, return HTML out. Composing
// adapters happens in `src/build/subscribe-forms.ts` (the
// `transformSubscribeForms` entry point already wired into the build
// pipeline). The split keeps each provider's quirks (Beehiiv expects a
// `publication_id` POST endpoint, Buttondown wants a username-keyed embed URL,
// Custom takes a raw form action plus a field map) isolated from the
// pipeline-level orchestration.

export type SubscribeProvider =
  | 'none'
  | 'buttondown'
  | 'beehiiv'
  | 'convertkit'
  | 'mailerlite'
  | 'mailchimp'
  | 'emailoctopus'
  | 'listmonk'
  | 'customformaction'
  | 'custom';

export type SubscribeFormMethod = 'get' | 'post';

export interface SubscribeAdapterConfig {
  provider: SubscribeProvider;
  // Buttondown / Beehiiv / Mailchimp username or publication identifier.
  username?: string | undefined;
  // Beehiiv publication id (UUID) used as the API POST path segment.
  publication_id?: string | undefined;
  // ConvertKit / Kit form id used by the hosted form POST endpoint.
  form_id?: string | undefined;
  // listmonk public list UUID. `list_ids` is preferred for multi-list forms.
  list_id?: string | undefined;
  list_ids?: ReadonlyArray<string> | undefined;
  // Explicit form action (custom + provider embeds that expose a public action).
  action?: string | undefined;
  // HTML form method. Providers default to POST; custom backends may opt into GET.
  method?: SubscribeFormMethod | undefined;
  // Default email field name override.
  email_field_name?: string | undefined;
  // Default name field name override for inputs marked `data-members-name`.
  name_field_name?: string | undefined;
  // Custom provider: map of logical field name -> form field name. Only
  // `email` and `name` are consulted today; future-proofs against hidden field
  // additions without another top-level schema key.
  field_map?: Record<string, string> | undefined;
  // Provider=none only. CSS selectors of wrapping elements to strip from
  // the rendered HTML entirely (e.g. `.gh-footer-signup`, `.gh-cta`). The
  // sub-tree under each matching opening tag is removed; nested tags of
  // the same name are tolerated.
  strip_selectors?: ReadonlyArray<string> | undefined;
}

// What the orchestrator needs to rewrite a single form: the resolved action
// URL, the form's email field name, and whether the form should be
// neutralised (provider=none keeps the markup but disables submit).
export interface ResolvedSubscribeForm {
  action: string;
  emailFieldName: string;
  nameFieldName: string;
  method: SubscribeFormMethod;
  disabled: boolean;
  hiddenFields?: ReadonlyArray<ResolvedSubscribeHiddenField> | undefined;
}

export interface ResolvedSubscribeHiddenField {
  readonly name: string;
  readonly value: string;
}

// Adapter contract. `resolve()` returns the per-form rewrite plan;
// `transform()` is the optional whole-document rewrite hook adapters use when
// they need to do more than tweak `<form>` / `<input>` attributes (Beehiiv
// adds `data-beehiiv-publication-id`, none strips wrapper selectors, etc).
//
// Adapters that only need the per-form plan can omit `transform`.
export interface PortalAdapter {
  readonly provider: SubscribeProvider;
  resolve(cfg: SubscribeAdapterConfig): ResolvedSubscribeForm;
  transform?(html: string, cfg: SubscribeAdapterConfig): string;
}
