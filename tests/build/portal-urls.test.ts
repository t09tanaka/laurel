import { describe, expect, test } from 'bun:test';
import { type PortalConfig, resolvePortalUrls } from '~/build/portal-urls.ts';

function makeCfg(overrides: Partial<PortalConfig>): PortalConfig {
  return {
    provider: 'none',
    paid: false,
    invite_only: false,
    ...overrides,
  };
}

describe('resolvePortalUrls', () => {
  test('provider="none" returns no URLs', () => {
    expect(resolvePortalUrls(makeCfg({ provider: 'none' }))).toEqual({});
  });

  test('provider="ghost" returns no URLs (Ghost Portal script keeps the #/portal/ hashes)', () => {
    expect(resolvePortalUrls(makeCfg({ provider: 'ghost' }))).toEqual({});
  });

  test('provider="custom" with no overrides returns no URLs', () => {
    expect(resolvePortalUrls(makeCfg({ provider: 'custom' }))).toEqual({});
  });

  test('provider="custom" emits only the URLs the operator overrides', () => {
    const out = resolvePortalUrls(
      makeCfg({
        provider: 'custom',
        signup_url: 'https://example.test/subscribe',
        account_url: 'https://example.test/me',
      }),
    );
    expect(out).toEqual({
      signup: 'https://example.test/subscribe',
      account: 'https://example.test/me',
    });
  });

  test('provider="buttondown" infers signup/signin/account from publication', () => {
    const out = resolvePortalUrls(
      makeCfg({ provider: 'buttondown', publication: 'my-newsletter' }),
    );
    expect(out).toEqual({
      signup: 'https://buttondown.email/my-newsletter',
      signin: 'https://buttondown.email/login',
      account: 'https://buttondown.email/account',
    });
  });

  test('provider="buttondown" lets explicit *_url override the inferred defaults', () => {
    const out = resolvePortalUrls(
      makeCfg({
        provider: 'buttondown',
        publication: 'my-newsletter',
        signin_url: 'https://example.test/sign-in',
        upgrade_url: 'https://example.test/upgrade',
      }),
    );
    expect(out.signup).toBe('https://buttondown.email/my-newsletter');
    expect(out.signin).toBe('https://example.test/sign-in');
    expect(out.account).toBe('https://buttondown.email/account');
    expect(out.upgrade).toBe('https://example.test/upgrade');
  });

  test('provider="buttondown" with publication-only and no signin/account leaks no slug-shaped URL', () => {
    // Sanity check: encodeURIComponent runs on the slug.
    const out = resolvePortalUrls(makeCfg({ provider: 'buttondown', publication: 'a b/c' }));
    expect(out.signup).toBe('https://buttondown.email/a%20b%2Fc');
  });

  test('provider="beehiiv" infers URLs from publication', () => {
    const out = resolvePortalUrls(makeCfg({ provider: 'beehiiv', publication: 'my-pub' }));
    expect(out.signup).toBe('https://my-pub.beehiiv.com/subscribe');
    expect(out.signin).toBe('https://app.beehiiv.com/users/sign_in');
    expect(out.account).toBe('https://app.beehiiv.com/dashboard');
  });

  test('provider="substack" infers URLs from publication', () => {
    const out = resolvePortalUrls(makeCfg({ provider: 'substack', publication: 'mysub' }));
    expect(out.signup).toBe('https://mysub.substack.com/subscribe');
    expect(out.signin).toBe('https://substack.com/sign-in');
    expect(out.account).toBe('https://mysub.substack.com/account');
  });

  test('provider="convertkit" treats publication as a form id', () => {
    const out = resolvePortalUrls(makeCfg({ provider: 'convertkit', publication: '12345' }));
    expect(out.signup).toBe('https://app.kit.com/forms/12345/subscriptions');
    expect(out.signin).toBe('https://app.kit.com/users/login');
    expect(out.account).toBe('https://app.kit.com/account_settings');
  });

  test('provider="bentonow" requires explicit URLs (no canonical convention to infer)', () => {
    expect(resolvePortalUrls(makeCfg({ provider: 'bentonow' }))).toEqual({});
    const out = resolvePortalUrls(
      makeCfg({ provider: 'bentonow', signup_url: 'https://example.test/form' }),
    );
    expect(out).toEqual({ signup: 'https://example.test/form' });
  });

  test('manual newsletter providers require explicit URLs (no canonical convention to infer)', () => {
    for (const provider of ['mailerlite', 'mailchimp', 'emailoctopus'] as const) {
      expect(resolvePortalUrls(makeCfg({ provider }))).toEqual({});
      const out = resolvePortalUrls(
        makeCfg({ provider, signin_url: `https://example.test/${provider}/login` }),
      );
      expect(out).toEqual({ signin: `https://example.test/${provider}/login` });
    }
  });

  test('provider="buttondown" without publication still wires the constant signin/account but skips signup', () => {
    const out = resolvePortalUrls(makeCfg({ provider: 'buttondown' }));
    expect(out.signup).toBeUndefined();
    expect(out.signin).toBe('https://buttondown.email/login');
    expect(out.account).toBe('https://buttondown.email/account');
  });

  test('provider="buttondown" with no publication but explicit overrides still resolves', () => {
    const out = resolvePortalUrls(
      makeCfg({ provider: 'buttondown', signin_url: 'https://example.test/sign-in' }),
    );
    // signup falls back to inferred (which is undefined without publication),
    // signin uses the explicit override, account falls back to the buttondown default.
    expect(out.signup).toBeUndefined();
    expect(out.signin).toBe('https://example.test/sign-in');
    expect(out.account).toBe('https://buttondown.email/account');
  });

  test('invite_only suppresses public signup URLs but keeps sign-in/account URLs', () => {
    const out = resolvePortalUrls(
      makeCfg({
        provider: 'buttondown',
        invite_only: true,
        publication: 'private-list',
        signup_url: 'https://example.test/subscribe',
      }),
    );

    expect(out.signup).toBeUndefined();
    expect(out.signin).toBe('https://buttondown.email/login');
    expect(out.account).toBe('https://buttondown.email/account');
  });
});
