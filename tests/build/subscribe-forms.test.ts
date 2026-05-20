import { describe, expect, test } from 'bun:test';
import { resolveSubscribeForm, transformSubscribeForms } from '~/build/subscribe-forms.ts';

const SAMPLE_FORM = [
  '<form class="gh-form" data-members-form>',
  '<input class="gh-form-input" id="email" name="email" type="email" required data-members-email>',
  '<button type="submit">Subscribe</button>',
  '</form>',
].join('\n');

describe('resolveSubscribeForm', () => {
  test('returns disabled stub when provider is "none"', () => {
    const r = resolveSubscribeForm({ provider: 'none' });
    expect(r.action).toBe('#');
    expect(r.disabled).toBe(true);
    expect(r.emailFieldName).toBe('email');
  });

  test('uses Buttondown embed URL with encoded username', () => {
    const r = resolveSubscribeForm({ provider: 'buttondown', username: 'my newsletter' });
    expect(r.action).toBe('https://buttondown.email/api/emails/embed-subscribe/my%20newsletter');
    expect(r.emailFieldName).toBe('email');
    expect(r.disabled).toBe(false);
  });

  test('throws when buttondown provider is missing username', () => {
    expect(() => resolveSubscribeForm({ provider: 'buttondown' })).toThrow(/username/);
  });

  test('uses Mailchimp action and EMAIL field name by default', () => {
    const action = 'https://example.us1.list-manage.com/subscribe/post?u=abc&id=xyz';
    const r = resolveSubscribeForm({ provider: 'mailchimp', action });
    expect(r.action).toBe(action);
    expect(r.emailFieldName).toBe('EMAIL');
    expect(r.disabled).toBe(false);
  });

  test('throws when mailchimp provider is missing action', () => {
    expect(() => resolveSubscribeForm({ provider: 'mailchimp' })).toThrow(/action/);
  });

  test('custom provider uses configured action and defaults to email field name', () => {
    const r = resolveSubscribeForm({ provider: 'custom', action: 'https://example.com/sub' });
    expect(r.action).toBe('https://example.com/sub');
    expect(r.emailFieldName).toBe('email');
  });

  test('custom provider can override email field name', () => {
    const r = resolveSubscribeForm({
      provider: 'custom',
      action: 'https://example.com/sub',
      email_field_name: 'subscriber_email',
    });
    expect(r.emailFieldName).toBe('subscriber_email');
  });

  test('throws when custom provider is missing action', () => {
    expect(() => resolveSubscribeForm({ provider: 'custom' })).toThrow(/action/);
  });

  test('uses Beehiiv subscriptions API endpoint with publication_id', () => {
    const r = resolveSubscribeForm({ provider: 'beehiiv', publication_id: 'pub_123' });
    expect(r.action).toBe('https://api.beehiiv.com/v2/publications/pub_123/subscriptions');
    expect(r.emailFieldName).toBe('email');
    expect(r.disabled).toBe(false);
  });

  test('throws when beehiiv provider is missing publication_id', () => {
    expect(() => resolveSubscribeForm({ provider: 'beehiiv' })).toThrow(/publication_id/);
  });

  test('custom provider field_map.email overrides email_field_name', () => {
    const r = resolveSubscribeForm({
      provider: 'custom',
      action: 'https://example.com/sub',
      email_field_name: 'fallback',
      field_map: { email: 'your_email_field' },
    });
    expect(r.emailFieldName).toBe('your_email_field');
  });
});

describe('transformSubscribeForms', () => {
  test('leaves HTML untouched when no members-form markers are present', () => {
    const html = '<p>no forms here</p>';
    expect(transformSubscribeForms(html, { provider: 'none' })).toBe(html);
  });

  test('with provider=none, neutralises form submission and keeps default field name', () => {
    const out = transformSubscribeForms(SAMPLE_FORM, { provider: 'none' });
    expect(out).toMatch(/<form[^>]*\baction="#"/);
    expect(out).toMatch(/<form[^>]*\bonsubmit="event\.preventDefault\(\);return false;"/);
    expect(out).toMatch(/<input[^>]*\bname="email"/);
  });

  test('with provider=none, preserves Dawn-style members form hooks as inert markup', () => {
    const html = [
      '<form class="gh-form" data-members-form="subscribe">',
      '<input class="gh-form-input" type="email" required data-members-email>',
      '<button class="gh-button" type="submit">Subscribe now</button>',
      '<p class="gh-form-success" data-members-success>Check your inbox.</p>',
      '<p class="gh-form-error" data-members-error>Could not subscribe.</p>',
      '</form>',
    ].join('');
    const out = transformSubscribeForms(html, { provider: 'none' });

    expect(out).toContain('data-members-form="subscribe"');
    expect(out).toContain('data-members-email');
    expect(out).toContain('data-members-success');
    expect(out).toContain('data-members-error');
    expect(out).toMatch(/<form[^>]*\baction="#"/);
    expect(out).toMatch(/<form[^>]*\bonsubmit="event\.preventDefault\(\);return false;"/);
    expect(out).toMatch(/<input[^>]*\bname="email"/);
  });

  test('with buttondown provider, sets action to embed URL and keeps "email" name', () => {
    const out = transformSubscribeForms(SAMPLE_FORM, {
      provider: 'buttondown',
      username: 'jamie',
    });
    expect(out).toContain('action="https://buttondown.email/api/emails/embed-subscribe/jamie"');
    expect(out).toMatch(/<input[^>]*\bname="email"/);
    expect(out).not.toMatch(/onsubmit=/);
  });

  test('with mailchimp provider, sets action and rewrites input name to EMAIL', () => {
    const action = 'https://example.us1.list-manage.com/subscribe/post?u=abc&amp;id=xyz';
    const out = transformSubscribeForms(SAMPLE_FORM, { provider: 'mailchimp', action });
    expect(out).toContain(`action="${action.replace(/&/g, '&amp;')}"`);
    expect(out).toMatch(/<input[^>]*\bname="EMAIL"/);
    expect(out).not.toMatch(/<input[^>]*\bname="email"/);
  });

  test('with custom provider and email_field_name override, rewrites both attributes', () => {
    const out = transformSubscribeForms(SAMPLE_FORM, {
      provider: 'custom',
      action: 'https://hooks.example.com/subscribe',
      email_field_name: 'subscriber_email',
    });
    expect(out).toContain('action="https://hooks.example.com/subscribe"');
    expect(out).toMatch(/<input[^>]*\bname="subscriber_email"/);
  });

  test('replaces an existing action attribute rather than appending a duplicate', () => {
    const formWithAction = SAMPLE_FORM.replace(
      '<form class="gh-form" data-members-form>',
      '<form class="gh-form" action="/old" data-members-form>',
    );
    const out = transformSubscribeForms(formWithAction, {
      provider: 'buttondown',
      username: 'jamie',
    });
    const actionMatches = out.match(/action="[^"]*"/g) ?? [];
    expect(actionMatches.length).toBe(1);
    expect(out).toContain('action="https://buttondown.email/api/emails/embed-subscribe/jamie"');
  });

  test('escapes double quotes in action URLs', () => {
    const out = transformSubscribeForms(SAMPLE_FORM, {
      provider: 'custom',
      action: 'https://example.com/?q="x"',
    });
    expect(out).toContain('action="https://example.com/?q=&quot;x&quot;"');
  });

  test('handles multiple subscribe forms in the same document', () => {
    const html = `${SAMPLE_FORM}\n<p>between</p>\n${SAMPLE_FORM}`;
    const out = transformSubscribeForms(html, {
      provider: 'buttondown',
      username: 'jamie',
    });
    const actionCount = (out.match(/action="https:\/\/buttondown/g) ?? []).length;
    expect(actionCount).toBe(2);
  });

  test('does not touch unrelated <form> tags without data-members-form', () => {
    const html = '<form action="/search"><input name="q" /></form>';
    const out = transformSubscribeForms(html, { provider: 'buttondown', username: 'j' });
    expect(out).toBe(html);
  });

  test('with beehiiv provider, rewrites action to the publications API', () => {
    const out = transformSubscribeForms(SAMPLE_FORM, {
      provider: 'beehiiv',
      publication_id: 'pub_abc',
    });
    expect(out).toContain('action="https://api.beehiiv.com/v2/publications/pub_abc/subscriptions"');
    expect(out).toMatch(/<input[^>]*\bname="email"/);
    expect(out).not.toMatch(/onsubmit=/);
  });

  test('with custom provider and field_map, rewrites input name to mapped value', () => {
    const out = transformSubscribeForms(SAMPLE_FORM, {
      provider: 'custom',
      action: 'https://hooks.example.com/subscribe',
      field_map: { email: 'your_email_field' },
    });
    expect(out).toContain('action="https://hooks.example.com/subscribe"');
    expect(out).toMatch(/<input[^>]*\bname="your_email_field"/);
  });

  test('with provider=none and strip_selectors, removes wrapping CTA elements', () => {
    const html = [
      '<header>keep</header>',
      '<div class="gh-footer-signup">',
      SAMPLE_FORM,
      '</div>',
      '<footer>tail</footer>',
    ].join('');
    const out = transformSubscribeForms(html, {
      provider: 'none',
      strip_selectors: ['.gh-footer-signup'],
    });
    expect(out).not.toContain('gh-footer-signup');
    expect(out).not.toContain('data-members-form');
    expect(out).toContain('<header>keep</header>');
    expect(out).toContain('<footer>tail</footer>');
  });
});
