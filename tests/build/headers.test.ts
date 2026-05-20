import { describe, expect, spyOn, test } from 'bun:test';
import { buildHeadersBody, validateHstsForPreload } from '~/build/headers.ts';
import { configSchema } from '~/config/schema.ts';
import { logger } from '~/util/logger.ts';

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

describe('validateHstsForPreload', () => {
  test('passes through a value without preload directive unchanged', () => {
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const value = 'max-age=63072000; includeSubDomains';
      expect(validateHstsForPreload(value)).toBe(value);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test('warns when preload is set but max-age is below 1 year', () => {
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      validateHstsForPreload('max-age=600; includeSubDomains; preload');
      const calls = warn.mock.calls.flat().join('\n');
      expect(calls).toContain('preload-list minimum');
    } finally {
      warn.mockRestore();
    }
  });

  test('warns when preload is set but includeSubDomains is missing', () => {
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      validateHstsForPreload('max-age=63072000; preload');
      const calls = warn.mock.calls.flat().join('\n');
      expect(calls).toContain('includeSubDomains');
    } finally {
      warn.mockRestore();
    }
  });

  test('accepts a fully eligible preload value without warning', () => {
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const value = 'max-age=63072000; includeSubDomains; preload';
      expect(validateHstsForPreload(value)).toBe(value);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test('routes Strict-Transport-Security through validation when emitted', () => {
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const headers = parseConfig({
        security: {
          strict_transport_security: 'max-age=600; preload',
        },
      });
      const body = buildHeadersBody(headers);
      expect(body).toContain('Strict-Transport-Security: max-age=600; preload');
      const calls = warn.mock.calls.flat().join('\n');
      expect(calls).toContain('preload-list minimum');
    } finally {
      warn.mockRestore();
    }
  });
});
