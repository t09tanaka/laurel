import type { PortalConfig } from '~/build/portal-urls.ts';

// Surface diagnostics for `[components.portal]` configurations that parse
// cleanly through the schema (provider is one of the known enum values) but
// would silently no-op at render time because no destination URLs can be
// resolved. Without this gate, an operator who writes
//
//     [components.portal]
//     provider = "custom"
//     # forgot to set signup_url / signin_url / account_url / upgrade_url
//
// gets a build with dead `data-portal="signup"` buttons that look right in
// markup but go nowhere on click — exactly the kind of "silent no-op" that
// #493 was opened against. Each finding carries a human-readable message; the
// build pipeline lifts them through the shared `logger.warn` so they land in
// the same warning summary as other build-time misconfigurations.
//
// Zod already enforces the provider enum at config-load time, so an unknown
// string (`provider = "unknownadapter"`) never reaches here — it surfaces as
// a config-validation error instead. The set below is therefore a defensive
// safety net for the internal contract: if a new provider is added to the
// schema enum without wiring it into the portal-urls resolver, callers see
// a build-time warning instead of a silent UI dead-end.

const KNOWN_PROVIDERS: ReadonlySet<PortalConfig['provider']> = new Set([
  'none',
  'ghost',
  'custom',
  'buttondown',
  'beehiiv',
  'substack',
  'convertkit',
  'bentonow',
  'mailerlite',
  'mailchimp',
  'emailoctopus',
]);

// Providers whose canonical URL shape (`https://<publication>.<host>/...`)
// can be inferred from `[components.portal].publication` alone. When the
// operator picks one of these but leaves `publication` blank AND skips every
// `*_url` override, no portal button gets a destination — that combination
// is what the warning surfaces.
const INFER_FROM_PUBLICATION: ReadonlySet<PortalConfig['provider']> = new Set([
  'buttondown',
  'beehiiv',
  'substack',
  'convertkit',
]);

// Providers that have no canonical URL shape at all. For these the operator
// MUST supply at least one `*_url` override — otherwise the rewrite is a no-op
// and the dead Ghost-default `#/portal/signup` href ships untouched.
const REQUIRE_EXPLICIT_OVERRIDES: ReadonlySet<PortalConfig['provider']> = new Set([
  'bentonow',
  'mailerlite',
  'mailchimp',
  'emailoctopus',
]);

interface PortalValidationFinding {
  // Stable identifier so tests can assert on the specific class of warning
  // without depending on the exact wording.
  readonly code:
    | 'unknown_provider'
    | 'custom_without_urls'
    | 'inferred_provider_missing_publication'
    | 'manual_provider_missing_urls';
  readonly message: string;
}

function hasAnyOverride(cfg: PortalConfig): boolean {
  return Boolean(cfg.signup_url || cfg.signin_url || cfg.account_url || cfg.upgrade_url);
}

export function validatePortalConfig(cfg: PortalConfig): PortalValidationFinding[] {
  const findings: PortalValidationFinding[] = [];

  // Defensive net for an internal contract: if a future schema change adds a
  // provider enum value without updating the resolver registry, we surface a
  // warning at build start instead of silently dropping the portal rewrite.
  if (!KNOWN_PROVIDERS.has(cfg.provider)) {
    findings.push({
      code: 'unknown_provider',
      message: `[components.portal].provider = "${cfg.provider}" is not a recognised adapter; falling back to no-op portal markup. Known providers: ${Array.from(KNOWN_PROVIDERS).join(', ')}.`,
    });
    return findings;
  }

  // `none` and `ghost` resolve to an empty URL set by design (no rewrite),
  // so they never warrant a warning here regardless of override state.
  if (cfg.provider === 'none' || cfg.provider === 'ghost') return findings;

  if (cfg.provider === 'custom' && !hasAnyOverride(cfg)) {
    findings.push({
      code: 'custom_without_urls',
      message:
        '[components.portal].provider = "custom" but none of signup_url / signin_url / account_url / upgrade_url are set; portal buttons will keep their inert Ghost-default "#/portal/*" hrefs.',
    });
    return findings;
  }

  if (INFER_FROM_PUBLICATION.has(cfg.provider) && !cfg.publication && !hasAnyOverride(cfg)) {
    findings.push({
      code: 'inferred_provider_missing_publication',
      message: `[components.portal].provider = "${cfg.provider}" needs either a "publication" slug to infer URLs from, or at least one of signup_url / signin_url / account_url / upgrade_url. Without one of these, portal buttons stay inert.`,
    });
    return findings;
  }

  if (REQUIRE_EXPLICIT_OVERRIDES.has(cfg.provider) && !hasAnyOverride(cfg)) {
    findings.push({
      code: 'manual_provider_missing_urls',
      message: `[components.portal].provider = "${cfg.provider}" has no canonical URL shape; set at least one of signup_url / signin_url / account_url / upgrade_url, otherwise the portal rewrite is a no-op.`,
    });
  }

  return findings;
}
