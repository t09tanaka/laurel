import { describe, expect, test } from 'bun:test';
import { buildHeadersBody } from '~/build/headers.ts';
import { configSchema } from '~/config/schema.ts';

function defaultHeaders() {
  return configSchema.parse({ site: { title: 'x' } }).deploy.headers;
}

function parseConfig(headers: unknown) {
  return configSchema.parse({
    site: { title: 'x' },
    deploy: { headers },
  }).deploy.headers;
}

describe('buildHeadersBody', () => {
  test('emits each cache rule with two-space indentation', () => {
    const body = buildHeadersBody(defaultHeaders());

    expect(body).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable');
    expect(body).toContain(
      '/content/images/*\n  Cache-Control: public, max-age=31536000, immutable',
    );
  });

  test('keeps the catch-all rule last even when configured first', () => {
    const headers = parseConfig({
      cache_rules: [
        { pattern: '/*', cache_control: 'public, max-age=0, must-revalidate' },
        { pattern: '/assets/*', cache_control: 'public, max-age=31536000, immutable' },
      ],
    });

    const body = buildHeadersBody(headers);
    const assetsIdx = body.indexOf('/assets/*');
    const catchAllIdx = body.indexOf('\n/*\n');
    expect(assetsIdx).toBeGreaterThanOrEqual(0);
    expect(catchAllIdx).toBeGreaterThan(assetsIdx);
  });

  test('attaches custom security headers to the catch-all rule', () => {
    const headers = parseConfig({
      security: {
        content_security_policy: "default-src 'self'",
        strict_transport_security: 'max-age=63072000; includeSubDomains',
        permissions_policy: 'camera=(), microphone=()',
      },
    });

    const body = buildHeadersBody(headers);
    const catchAllSection = body.slice(body.indexOf('\n/*\n'));
    expect(catchAllSection).toContain("Content-Security-Policy: default-src 'self'");
    expect(catchAllSection).toContain(
      'Strict-Transport-Security: max-age=63072000; includeSubDomains',
    );
    expect(catchAllSection).toContain('Permissions-Policy: camera=(), microphone=()');
  });

  test('omits security headers explicitly set to null', () => {
    const headers = parseConfig({
      security: {
        content_type_options: null,
        referrer_policy: null,
      },
    });

    const body = buildHeadersBody(headers);
    expect(body).not.toContain('X-Content-Type-Options');
    expect(body).not.toContain('Referrer-Policy');
  });

  test('emits custom header pairs from security.custom on the catch-all rule', () => {
    const headers = parseConfig({
      security: {
        custom: { 'X-Robots-Tag': 'noindex, nofollow' },
      },
    });

    const body = buildHeadersBody(headers);
    const catchAllSection = body.slice(body.indexOf('\n/*\n'));
    expect(catchAllSection).toContain('X-Robots-Tag: noindex, nofollow');
  });

  test('synthesizes a catch-all rule when only security headers are configured', () => {
    const headers = parseConfig({
      cache_rules: [],
      security: {
        content_type_options: null,
        referrer_policy: null,
        frame_options: 'DENY',
      },
    });

    const body = buildHeadersBody(headers);
    expect(body).toBe('/*\n  X-Frame-Options: DENY\n');
  });

  test('deduplicates repeated patterns by keeping the first occurrence', () => {
    const headers = parseConfig({
      cache_rules: [
        { pattern: '/assets/*', cache_control: 'public, max-age=31536000, immutable' },
        { pattern: '/assets/*', cache_control: 'no-store' },
        { pattern: '/*', cache_control: 'public, max-age=0, must-revalidate' },
      ],
    });

    const body = buildHeadersBody(headers);
    expect(body).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable');
    expect(body).not.toContain('Cache-Control: no-store');
  });

  test('produces an empty string when no rules and no security headers are configured', () => {
    const headers = parseConfig({
      cache_rules: [],
      security: {
        content_type_options: null,
        referrer_policy: null,
      },
    });

    expect(buildHeadersBody(headers)).toBe('');
  });
});
