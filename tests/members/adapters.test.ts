import { describe, expect, test } from 'bun:test';
import { beehiivAdapter } from '~/members/adapters/beehiiv.ts';
import { buttondownAdapter } from '~/members/adapters/buttondown.ts';
import { customAdapter } from '~/members/adapters/custom.ts';
import { customFormActionAdapter } from '~/members/adapters/customformaction.ts';
import { listmonkAdapter } from '~/members/adapters/listmonk.ts';
import { mailchimpAdapter } from '~/members/adapters/mailchimp.ts';
import { noneAdapter, stripBySelector } from '~/members/adapters/none.ts';

describe('beehiiv adapter', () => {
  test('builds the API subscriptions endpoint from publication_id', () => {
    const r = beehiivAdapter.resolve({ provider: 'beehiiv', publication_id: 'pub_abc-123' });
    expect(r.action).toBe('https://api.beehiiv.com/v2/publications/pub_abc-123/subscriptions');
    expect(r.emailFieldName).toBe('email');
    expect(r.disabled).toBe(false);
  });

  test('falls back to username when publication_id is omitted', () => {
    const r = beehiivAdapter.resolve({ provider: 'beehiiv', username: 'pub_xyz' });
    expect(r.action).toBe('https://api.beehiiv.com/v2/publications/pub_xyz/subscriptions');
  });

  test('throws when no publication_id or username is supplied', () => {
    expect(() => beehiivAdapter.resolve({ provider: 'beehiiv' })).toThrow(/publication_id/);
  });

  test('url-encodes publication ids with awkward characters', () => {
    const r = beehiivAdapter.resolve({ provider: 'beehiiv', publication_id: 'pub a/b' });
    expect(r.action).toBe('https://api.beehiiv.com/v2/publications/pub%20a%2Fb/subscriptions');
  });
});

describe('buttondown adapter', () => {
  test('builds the embed-subscribe endpoint from username', () => {
    const r = buttondownAdapter.resolve({ provider: 'buttondown', username: 'jamie' });
    expect(r.action).toBe('https://buttondown.email/api/emails/embed-subscribe/jamie');
    expect(r.emailFieldName).toBe('email');
  });

  test('throws without username', () => {
    expect(() => buttondownAdapter.resolve({ provider: 'buttondown' })).toThrow(/username/);
  });

  test('field_map.email overrides the default field name', () => {
    const r = buttondownAdapter.resolve({
      provider: 'buttondown',
      username: 'jamie',
      email_field_name: 'fallback',
      field_map: { email: 'subscriber[email]' },
    });
    expect(r.emailFieldName).toBe('subscriber[email]');
  });
});

describe('mailchimp adapter', () => {
  test('keeps the operator-supplied action verbatim and defaults to EMAIL', () => {
    const r = mailchimpAdapter.resolve({
      provider: 'mailchimp',
      action: 'https://example.us1.list-manage.com/subscribe/post?u=abc&id=xyz',
    });
    expect(r.action).toBe('https://example.us1.list-manage.com/subscribe/post?u=abc&id=xyz');
    expect(r.emailFieldName).toBe('EMAIL');
  });

  test('throws when action is missing', () => {
    expect(() => mailchimpAdapter.resolve({ provider: 'mailchimp' })).toThrow(/action/);
  });
});

describe('listmonk adapter', () => {
  test('keeps the public subscription endpoint and injects list UUID as l', () => {
    const r = listmonkAdapter.resolve({
      provider: 'listmonk',
      action: 'https://lists.example.com/api/public/subscription',
      list_id: 'eb420c55-4cfb-4972-92ba-c93c34ba475d',
    });
    expect(r.action).toBe('https://lists.example.com/api/public/subscription');
    expect(r.emailFieldName).toBe('email');
    expect(r.hiddenFields).toEqual([{ name: 'l', value: 'eb420c55-4cfb-4972-92ba-c93c34ba475d' }]);
  });

  test('supports multiple list UUIDs', () => {
    const r = listmonkAdapter.resolve({
      provider: 'listmonk',
      action: 'https://lists.example.com/api/public/subscription',
      list_ids: ['list-a', 'list-b'],
    });
    expect(r.hiddenFields).toEqual([
      { name: 'l', value: 'list-a' },
      { name: 'l', value: 'list-b' },
    ]);
  });

  test('throws when action or list UUID is missing', () => {
    expect(() => listmonkAdapter.resolve({ provider: 'listmonk', list_id: 'list-a' })).toThrow(
      /action/,
    );
    expect(() =>
      listmonkAdapter.resolve({
        provider: 'listmonk',
        action: 'https://lists.example.com/api/public/subscription',
      }),
    ).toThrow(/list_id/);
  });
});

describe('customformaction adapter', () => {
  test('uses the raw action and optional field map', () => {
    const r = customFormActionAdapter.resolve({
      provider: 'customformaction',
      action: 'https://forms.example.com/newsletter',
      field_map: { email: 'subscriber[email]', name: 'subscriber[name]' },
    });
    expect(r.action).toBe('https://forms.example.com/newsletter');
    expect(r.emailFieldName).toBe('subscriber[email]');
    expect(r.nameFieldName).toBe('subscriber[name]');
  });

  test('throws without an action', () => {
    expect(() => customFormActionAdapter.resolve({ provider: 'customformaction' })).toThrow(
      /action/,
    );
  });
});

describe('custom adapter', () => {
  test('uses the raw action verbatim and defaults to email field name', () => {
    const r = customAdapter.resolve({ provider: 'custom', action: 'https://example.com/sub' });
    expect(r.action).toBe('https://example.com/sub');
    expect(r.emailFieldName).toBe('email');
  });

  test('field_map.email overrides email_field_name', () => {
    const r = customAdapter.resolve({
      provider: 'custom',
      action: 'https://example.com/sub',
      email_field_name: 'subscriber_email',
      field_map: { email: 'your_email_field' },
    });
    expect(r.emailFieldName).toBe('your_email_field');
  });

  test('falls back to email_field_name when field_map.email is absent', () => {
    const r = customAdapter.resolve({
      provider: 'custom',
      action: 'https://example.com/sub',
      email_field_name: 'subscriber_email',
    });
    expect(r.emailFieldName).toBe('subscriber_email');
  });

  test('throws without an action', () => {
    expect(() => customAdapter.resolve({ provider: 'custom' })).toThrow(/action/);
  });
});

describe('none adapter', () => {
  test('returns the disabled stub form', () => {
    const r = noneAdapter.resolve({ provider: 'none' });
    expect(r.action).toBe('#');
    expect(r.disabled).toBe(true);
    expect(r.emailFieldName).toBe('email');
  });

  test('passes HTML through when no strip_selectors configured', () => {
    const html = '<div class="gh-footer-signup"><form data-members-form></form></div>';
    const transform = noneAdapter.transform;
    expect(transform).toBeDefined();
    expect(transform?.(html, { provider: 'none' })).toBe(html);
  });

  test('strips wrapping selectors when configured', () => {
    const html = [
      '<header>keep</header>',
      '<div class="gh-footer-signup"><form data-members-form><input data-members-email></form></div>',
      '<footer>also keep</footer>',
    ].join('');
    const out = noneAdapter.transform?.(html, {
      provider: 'none',
      strip_selectors: ['.gh-footer-signup'],
    });
    expect(out).toBe('<header>keep</header><footer>also keep</footer>');
  });

  test('strips multiple selectors and supports #id', () => {
    const html = '<div class="gh-cta">cta</div><section id="signup">sig</section><p>keep</p>';
    const out = noneAdapter.transform?.(html, {
      provider: 'none',
      strip_selectors: ['.gh-cta', '#signup'],
    });
    expect(out).toBe('<p>keep</p>');
  });
});

describe('stripBySelector edge cases', () => {
  test('handles nested elements of the same tag', () => {
    const html = '<div class="x"><div>inner</div></div><p>tail</p>';
    expect(stripBySelector(html, '.x')).toBe('<p>tail</p>');
  });

  test('matches only the targeted class', () => {
    const html = '<div class="a">keep me</div><div class="b">drop me</div>';
    expect(stripBySelector(html, '.b')).toBe('<div class="a">keep me</div>');
  });

  test('matches when class is one of several space-separated classes', () => {
    const html = '<div class="foo gh-cta bar">drop</div><p>keep</p>';
    expect(stripBySelector(html, '.gh-cta')).toBe('<p>keep</p>');
  });

  test('returns input unchanged when selector does not match', () => {
    const html = '<div class="x">stay</div>';
    expect(stripBySelector(html, '.y')).toBe(html);
  });
});
