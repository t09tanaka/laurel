export interface PortalConfig {
  provider:
    | 'none'
    | 'ghost'
    | 'custom'
    | 'buttondown'
    | 'beehiiv'
    | 'substack'
    | 'convertkit'
    | 'bentonow'
    | 'mailerlite'
    | 'mailchimp'
    | 'emailoctopus';
  paid: boolean;
  invite_only: boolean;
  publication?: string | undefined;
  signup_url?: string | undefined;
  signin_url?: string | undefined;
  account_url?: string | undefined;
  upgrade_url?: string | undefined;
}

export type PortalTrigger = 'signup' | 'signin' | 'account' | 'upgrade';

export type ResolvedPortalUrls = Partial<Record<PortalTrigger, string>>;

// Returns the concrete URLs to inject into `data-portal="..."` buttons.
// Providers without conventional URL shapes only emit the triggers an operator
// overrides; un-overridden buttons stay untouched rather than guessing a wrong
// endpoint and shipping a 404.
export function resolvePortalUrls(cfg: PortalConfig): ResolvedPortalUrls {
  switch (cfg.provider) {
    case 'none':
    case 'ghost':
      return {};
    case 'custom':
      return pickOverrides(cfg);
    case 'buttondown':
      return mergeOverrides(cfg, {
        signup: cfg.publication
          ? `https://buttondown.email/${encodeURIComponent(cfg.publication)}`
          : undefined,
        signin: 'https://buttondown.email/login',
        account: 'https://buttondown.email/account',
      });
    case 'beehiiv':
      return mergeOverrides(cfg, {
        signup: cfg.publication
          ? `https://${encodeURIComponent(cfg.publication)}.beehiiv.com/subscribe`
          : undefined,
        signin: 'https://app.beehiiv.com/users/sign_in',
        account: 'https://app.beehiiv.com/dashboard',
      });
    case 'substack':
      return mergeOverrides(cfg, {
        signup: cfg.publication
          ? `https://${encodeURIComponent(cfg.publication)}.substack.com/subscribe`
          : undefined,
        signin: 'https://substack.com/sign-in',
        account: cfg.publication
          ? `https://${encodeURIComponent(cfg.publication)}.substack.com/account`
          : undefined,
      });
    case 'convertkit':
      return mergeOverrides(cfg, {
        signup: cfg.publication
          ? `https://app.kit.com/forms/${encodeURIComponent(cfg.publication)}/subscriptions`
          : undefined,
        signin: 'https://app.kit.com/users/login',
        account: 'https://app.kit.com/account_settings',
      });
    case 'bentonow':
    case 'mailerlite':
    case 'mailchimp':
    case 'emailoctopus':
      return pickOverrides(cfg);
  }
}

function pickOverrides(cfg: PortalConfig): ResolvedPortalUrls {
  const out: ResolvedPortalUrls = {};
  if (!cfg.invite_only && cfg.signup_url) out.signup = cfg.signup_url;
  if (cfg.signin_url) out.signin = cfg.signin_url;
  if (cfg.account_url) out.account = cfg.account_url;
  if (cfg.upgrade_url) out.upgrade = cfg.upgrade_url;
  return out;
}

// Merge an operator's `*_url` overrides with the provider's inferred defaults.
// Any trigger that has neither an override nor an inferred default stays
// untouched — its `data-portal` button keeps its original href so the theme
// renders without errors even if the operator forgot a `publication` slug.
function mergeOverrides(cfg: PortalConfig, inferred: ResolvedPortalUrls): ResolvedPortalUrls {
  const merged: ResolvedPortalUrls = {};
  const signup = cfg.invite_only ? undefined : (cfg.signup_url ?? inferred.signup);
  if (signup) merged.signup = signup;
  const signin = cfg.signin_url ?? inferred.signin;
  if (signin) merged.signin = signin;
  const account = cfg.account_url ?? inferred.account;
  if (account) merged.account = account;
  const upgrade = cfg.upgrade_url ?? inferred.upgrade;
  if (upgrade) merged.upgrade = upgrade;
  return merged;
}
