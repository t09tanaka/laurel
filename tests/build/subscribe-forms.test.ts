import { describe, expect, test } from 'bun:test';
import {
  containsSubscribeFormMarkup,
  resolveSubscribeForm,
  transformSubscribeForms,
} from '~/build/subscribe-forms.ts';
import { SUBSCRIBE_NOOP_REASON, SUBSCRIBE_NOOP_RUNTIME_WARNING } from '~/members/noop.ts';

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
    expect(r.method).toBe('post');
    expect(r.disabled).toBe(false);
  });

  test('uses MailerLite action and fields[email] field name by default', () => {
    const action = 'https://app.mailerlite.com/webforms/submit/abc123';
    const r = resolveSubscribeForm({ provider: 'mailerlite', action });
    expect(r.action).toBe(action);
    expect(r.emailFieldName).toBe('fields[email]');
    expect(r.nameFieldName).toBe('fields[name]');
    expect(r.hiddenFields).toEqual([{ name: 'ml-submit', value: '1' }]);
    expect(r.method).toBe('post');
  });

  test('uses EmailOctopus list id endpoint and field_0 field name by default', () => {
    const r = resolveSubscribeForm({
      provider: 'emailoctopus',
      list_id: '72d84316-1496-11eb-a3d0-06b4694bee2a',
    });
    expect(r.action).toBe(
      'https://emailoctopus.com/lists/72d84316-1496-11eb-a3d0-06b4694bee2a/members/embedded/1.3/add',
    );
    expect(r.emailFieldName).toBe('field_0');
    expect(r.nameFieldName).toBe('field_1');
    expect(r.method).toBe('post');
  });

  test('uses ConvertKit hosted form endpoint and email_address field name', () => {
    const r = resolveSubscribeForm({ provider: 'convertkit', form_id: '12345' });
    expect(r.action).toBe('https://app.kit.com/forms/12345/subscriptions');
    expect(r.emailFieldName).toBe('email_address');
    expect(r.method).toBe('post');
    expect(r.disabled).toBe(false);
  });

  test('throws when convertkit provider is missing form_id', () => {
    expect(() => resolveSubscribeForm({ provider: 'convertkit' })).toThrow(/form_id/);
  });

  test('throws when mailchimp provider is missing action', () => {
    expect(() => resolveSubscribeForm({ provider: 'mailchimp' })).toThrow(/action/);
  });

  test('uses listmonk action and list UUID hidden fields', () => {
    const r = resolveSubscribeForm({
      provider: 'listmonk',
      action: 'https://lists.example.com/api/public/subscription',
      list_ids: ['list-a', 'list-b'],
    });
    expect(r.action).toBe('https://lists.example.com/api/public/subscription');
    expect(r.emailFieldName).toBe('email');
    expect(r.hiddenFields).toEqual([
      { name: 'l', value: 'list-a' },
      { name: 'l', value: 'list-b' },
    ]);
  });

  test('uses customformaction action and field mapping', () => {
    const r = resolveSubscribeForm({
      provider: 'customformaction',
      action: 'https://forms.example.com/newsletter',
      field_map: { email: 'subscriber_email' },
    });
    expect(r.action).toBe('https://forms.example.com/newsletter');
    expect(r.emailFieldName).toBe('subscriber_email');
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

  test('custom provider can override method and name field name', () => {
    const r = resolveSubscribeForm({
      provider: 'custom',
      action: 'https://example.com/sub',
      method: 'get',
      name_field_name: 'full_name',
    });
    expect(r.method).toBe('get');
    expect(r.nameFieldName).toBe('full_name');
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
    expect(containsSubscribeFormMarkup(html)).toBe(false);
    expect(transformSubscribeForms(html, { provider: 'none' })).toBe(html);
  });

  test('with provider=none, marks no-op forms and warns at runtime', () => {
    const out = transformSubscribeForms(SAMPLE_FORM, { provider: 'none' });
    expect(containsSubscribeFormMarkup(SAMPLE_FORM)).toBe(true);
    expect(out).toMatch(/<form[^>]*\baction="#"/);
    expect(out).toContain(`data-nectar-noop="${SUBSCRIBE_NOOP_REASON}"`);
    expect(out).toContain('window.console.warn');
    expect(out).toContain(SUBSCRIBE_NOOP_RUNTIME_WARNING);
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
    expect(out).toContain(`data-nectar-noop="${SUBSCRIBE_NOOP_REASON}"`);
    expect(out).toContain('window.console.warn');
    expect(out).toMatch(/<input[^>]*\bname="email"/);
  });

  test('with buttondown provider, sets action to embed URL and keeps "email" name', () => {
    const out = transformSubscribeForms(SAMPLE_FORM, {
      provider: 'buttondown',
      username: 'jamie',
    });
    expect(out).toContain('action="https://buttondown.email/api/emails/embed-subscribe/jamie"');
    expect(out).toMatch(/<input[^>]*\bname="email"/);
    expect(out).toMatch(
      /<input[^>]*\btype="text"[^>]*\bname="website"[^>]*\btabindex="-1"[^>]*\bautocomplete="off"[^>]*\bstyle="display:none"/,
    );
    expect(out).not.toMatch(/onsubmit=/);
  });

  test('with mailchimp provider, sets action and rewrites input name to EMAIL', () => {
    const action = 'https://example.us1.list-manage.com/subscribe/post?u=abc&amp;id=xyz';
    const out = transformSubscribeForms(SAMPLE_FORM, { provider: 'mailchimp', action });
    expect(out).toContain(`action="${action.replace(/&/g, '&amp;')}"`);
    expect(out).toMatch(/<form[^>]*\bmethod="post"/);
    expect(out).toMatch(/<input[^>]*\bname="EMAIL"/);
    expect(out).not.toMatch(/<input[^>]*\bname="email"/);
  });

  test('with mailerlite provider, maps inputs and injects ml-submit once', () => {
    const html = [
      '<form class="gh-form" data-members-form>',
      '<input type="hidden" name="ml-submit" value="1">',
      '<input type="text" data-members-name>',
      '<input type="email" data-members-email>',
      '<button type="submit">Subscribe</button>',
      '</form>',
    ].join('');
    const out = transformSubscribeForms(html, {
      provider: 'mailerlite',
      action: 'https://app.mailerlite.com/webforms/submit/abc123',
    });
    expect(out).toContain('action="https://app.mailerlite.com/webforms/submit/abc123"');
    expect(out).toMatch(/<input[^>]*\bdata-members-name[^>]*\bname="fields\[name\]"/);
    expect(out).toMatch(/<input[^>]*\bdata-members-email[^>]*\bname="fields\[email\]"/);
    expect(out.match(/name="ml-submit"/g) ?? []).toHaveLength(1);
  });

  test('with emailoctopus provider, maps inputs to field_1 and field_0', () => {
    const html = [
      '<form class="gh-form" data-members-form>',
      '<input type="text" data-members-name>',
      '<input type="email" data-members-email>',
      '<button type="submit">Subscribe</button>',
      '</form>',
    ].join('');
    const out = transformSubscribeForms(html, {
      provider: 'emailoctopus',
      list_id: '72d84316-1496-11eb-a3d0-06b4694bee2a',
    });
    expect(out).toContain(
      'action="https://emailoctopus.com/lists/72d84316-1496-11eb-a3d0-06b4694bee2a/members/embedded/1.3/add"',
    );
    expect(out).toMatch(/<input[^>]*\bdata-members-name[^>]*\bname="field_1"/);
    expect(out).toMatch(/<input[^>]*\bdata-members-email[^>]*\bname="field_0"/);
  });

  test('with custom provider, applies method and name field mapping', () => {
    const html = [
      '<form class="gh-form" data-members-form>',
      '<input type="text" data-members-name>',
      '<input type="email" data-members-email>',
      '<button type="submit">Subscribe</button>',
      '</form>',
    ].join('');
    const out = transformSubscribeForms(html, {
      provider: 'custom',
      action: 'https://hooks.example.com/subscribe',
      method: 'get',
      field_map: { email: 'subscriber_email', name: 'full_name' },
    });
    expect(out).toMatch(/<form[^>]*\bmethod="get"/);
    expect(out).toMatch(/<input[^>]*\bdata-members-name[^>]*\bname="full_name"/);
    expect(out).toMatch(/<input[^>]*\bdata-members-email[^>]*\bname="subscriber_email"/);
    expect(out).toMatch(/<button[^>]*\bdata-members-submit/);
  });

  test('with listmonk provider, injects l hidden fields without duplicating existing values', () => {
    const html = [
      '<form class="gh-form" data-members-form>',
      '<input type="hidden" name="l" value="list-a">',
      '<input type="text" data-members-name>',
      '<input type="email" data-members-email>',
      '<button type="submit">Subscribe</button>',
      '</form>',
    ].join('');
    const out = transformSubscribeForms(html, {
      provider: 'listmonk',
      action: 'https://lists.example.com/api/public/subscription',
      list_ids: ['list-a', 'list-b'],
    });
    expect(out).toContain('action="https://lists.example.com/api/public/subscription"');
    expect(out).toMatch(/<input[^>]*\bdata-members-email[^>]*\bname="email"/);
    expect(out).toMatch(/<input[^>]*\bdata-members-name[^>]*\bname="name"/);
    expect(out.match(/name="l"/g)?.length).toBe(2);
    expect(out).toContain('value="list-a"');
    expect(out).toContain('value="list-b"');
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
    expect(out).toMatch(/<input[^>]*\bname="website"/);
    expect(out).not.toMatch(/onsubmit=/);
  });

  test('does not duplicate an existing honeypot input on the same form', () => {
    const html = [
      '<form class="gh-form" data-members-form>',
      '<input type="text" name="website" tabindex="-1" autocomplete="off" style="display:none">',
      '<input type="email" data-members-email>',
      '<button type="submit">Subscribe</button>',
      '</form>',
    ].join('');
    const out = transformSubscribeForms(html, {
      provider: 'custom',
      action: 'https://hooks.example.com/subscribe',
    });
    expect(out.match(/name="website"/g) ?? []).toHaveLength(1);
  });

  test('with convertkit provider, rewrites action and email field for signup card markup', () => {
    const html = [
      '<div class="kg-card kg-signup-card">',
      '<form class="kg-signup-card-form" data-members-form="signup">',
      '<input class="kg-signup-card-input" type="email" placeholder="you@example.com" required>',
      '<button class="kg-signup-card-button" type="submit">Subscribe</button>',
      '</form>',
      '</div>',
    ].join('');
    const out = transformSubscribeForms(html, {
      provider: 'convertkit',
      form_id: '12345',
    });
    expect(out).toContain('action="https://app.kit.com/forms/12345/subscriptions"');
    expect(out).toMatch(/<input[^>]*\bdata-members-email[^>]*\bname="email_address"/);
    expect(out).toMatch(/<button[^>]*\bdata-members-submit/);
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
