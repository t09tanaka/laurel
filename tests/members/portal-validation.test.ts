import { describe, expect, test } from 'bun:test';
import type { PortalConfig } from '~/build/portal-urls.ts';
import { validatePortalConfig } from '~/members/portal-validation.ts';

function baseConfig(overrides: Partial<PortalConfig>): PortalConfig {
  return {
    provider: 'none',
    paid: false,
    invite_only: false,
    publication: undefined,
    signup_url: undefined,
    signin_url: undefined,
    account_url: undefined,
    upgrade_url: undefined,
    ...overrides,
  };
}

describe('validatePortalConfig (issue #493)', () => {
  test('provider="none" / "ghost" produce no findings (their no-op is by design)', () => {
    expect(validatePortalConfig(baseConfig({ provider: 'none' }))).toEqual([]);
    expect(validatePortalConfig(baseConfig({ provider: 'ghost' }))).toEqual([]);
  });

  test('provider="custom" without any *_url overrides surfaces a warning', () => {
    const findings = validatePortalConfig(baseConfig({ provider: 'custom' }));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('custom_without_urls');
    expect(findings[0]?.message).toMatch(/provider = "custom"/);
    expect(findings[0]?.message).toMatch(/signup_url/);
  });

  test('provider="custom" with at least one *_url override clears the warning', () => {
    const findings = validatePortalConfig(
      baseConfig({ provider: 'custom', signup_url: 'https://example.com/subscribe' }),
    );
    expect(findings).toEqual([]);
  });

  test('inferred-shape providers (buttondown, beehiiv, substack, convertkit) warn without publication + no overrides', () => {
    for (const provider of ['buttondown', 'beehiiv', 'substack', 'convertkit'] as const) {
      const findings = validatePortalConfig(baseConfig({ provider }));
      expect(findings).toHaveLength(1);
      expect(findings[0]?.code).toBe('inferred_provider_missing_publication');
      expect(findings[0]?.message).toMatch(provider);
    }
  });

  test('inferred providers with a publication slug pass without warning', () => {
    const findings = validatePortalConfig(
      baseConfig({ provider: 'beehiiv', publication: 'my-newsletter' }),
    );
    expect(findings).toEqual([]);
  });

  test('manual-only providers (bentonow, mailerlite) require at least one *_url override', () => {
    for (const provider of ['bentonow', 'mailerlite'] as const) {
      const findings = validatePortalConfig(baseConfig({ provider }));
      expect(findings).toHaveLength(1);
      expect(findings[0]?.code).toBe('manual_provider_missing_urls');
    }
  });

  test('manual-only provider with a signup_url override clears the warning', () => {
    const findings = validatePortalConfig(
      baseConfig({ provider: 'mailerlite', signup_url: 'https://example.com/subscribe' }),
    );
    expect(findings).toEqual([]);
  });

  test('unrecognised providers (defensive guard for future schema drift) report unknown_provider', () => {
    // Cast through unknown so the type system doesn't reject the synthetic
    // value — at runtime schema validation rejects this string before it
    // reaches the validator, but the defensive net catches an internal
    // contract break where a new enum value isn't wired into the registry.
    const findings = validatePortalConfig(
      baseConfig({ provider: 'unknownadapter' as unknown as PortalConfig['provider'] }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('unknown_provider');
    expect(findings[0]?.message).toMatch(/unknownadapter/);
  });
});
