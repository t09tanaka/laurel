import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCloudFrontResponseHeadersPolicy,
  emitCloudFrontResponseHeadersPolicy,
} from '~/build/cloudfront-response-headers.ts';
import { configSchema } from '~/config/schema.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'laurel-cloudfront-headers-'));
}

function parseHeaders(headers: unknown = {}) {
  return configSchema.parse({
    site: { title: 'x' },
    deploy: { headers },
  }).deploy.headers;
}

describe('buildCloudFrontResponseHeadersPolicy', () => {
  test('maps default deploy security headers into an AWS CLI response headers policy config', () => {
    const policy = buildCloudFrontResponseHeadersPolicy(parseHeaders());

    expect(policy.Name).toBe('laurel-generated-response-headers');
    expect(policy.SecurityHeadersConfig).toMatchObject({
      ContentTypeOptions: { Override: true },
      ReferrerPolicy: {
        Override: true,
        ReferrerPolicy: 'strict-origin-when-cross-origin',
      },
    });
    expect(JSON.stringify(policy)).not.toContain('Cache-Control');
  });

  test('maps CSP, HSTS, and unsupported first-class headers without losing custom headers', () => {
    const policy = buildCloudFrontResponseHeadersPolicy(
      parseHeaders({
        security: {
          content_security_policy: "default-src 'self'",
          strict_transport_security: 'max-age=63072000; includeSubDomains; preload',
          permissions_policy: 'camera=(), microphone=()',
          cross_origin_opener_policy: 'same-origin',
          custom: { 'X-Robots-Tag': 'noindex' },
        },
      }),
    );

    expect(policy.SecurityHeadersConfig).toMatchObject({
      ContentSecurityPolicy: {
        Override: true,
        ContentSecurityPolicy: "default-src 'self'",
      },
      StrictTransportSecurity: {
        Override: true,
        AccessControlMaxAgeSec: 63072000,
        IncludeSubdomains: true,
        Preload: true,
      },
    });
    expect(policy.CustomHeadersConfig).toEqual({
      Quantity: 3,
      Items: [
        {
          Header: 'Permissions-Policy',
          Value: 'camera=(), microphone=()',
          Override: true,
        },
        {
          Header: 'Cross-Origin-Opener-Policy',
          Value: 'same-origin',
          Override: true,
        },
        { Header: 'X-Robots-Tag', Value: 'noindex', Override: true },
      ],
    });
  });

  test('falls back to custom header emission when a configured value cannot use an AWS enum shape', () => {
    const policy = buildCloudFrontResponseHeadersPolicy(
      parseHeaders({
        security: {
          content_type_options: 'nosniff-extra',
          frame_options: 'ALLOW-FROM https://example.com',
          referrer_policy: 'experimental-policy',
          strict_transport_security: 'includeSubDomains',
        },
      }),
    );

    expect(policy.SecurityHeadersConfig?.ContentTypeOptions).toBeUndefined();
    expect(policy.SecurityHeadersConfig?.FrameOptions).toBeUndefined();
    expect(policy.SecurityHeadersConfig?.ReferrerPolicy).toBeUndefined();
    expect(policy.SecurityHeadersConfig?.StrictTransportSecurity).toBeUndefined();
    expect(policy.CustomHeadersConfig?.Items).toEqual(
      expect.arrayContaining([
        { Header: 'X-Content-Type-Options', Value: 'nosniff-extra', Override: true },
        {
          Header: 'X-Frame-Options',
          Value: 'ALLOW-FROM https://example.com',
          Override: true,
        },
        { Header: 'Referrer-Policy', Value: 'experimental-policy', Override: true },
        { Header: 'Strict-Transport-Security', Value: 'includeSubDomains', Override: true },
      ]),
    );
  });
});

describe('emitCloudFrontResponseHeadersPolicy', () => {
  test('writes the AWS CLI policy JSON under dist/.laurel', async () => {
    const outputDir = await makeOutputDir();

    await emitCloudFrontResponseHeadersPolicy({ outputDir, headers: parseHeaders() });

    const path = join(outputDir, '.laurel', 'cloudfront-response-headers-policy.json');
    expect(existsSync(path)).toBe(true);
    expect(existsSync(join(outputDir, 'cloudfront-response-headers-policy.json'))).toBe(false);

    const body = JSON.parse(await readFile(path, 'utf8'));
    expect(body.SecurityHeadersConfig.ReferrerPolicy.ReferrerPolicy).toBe(
      'strict-origin-when-cross-origin',
    );
  });
});
