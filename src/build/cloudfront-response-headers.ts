import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir } from '~/util/fs.ts';
import { type HeadersConfig, validateHstsForPreload } from './headers.ts';

export const CLOUDFRONT_RESPONSE_HEADERS_POLICY_FILE = 'cloudfront-response-headers-policy.json';

const DEFAULT_POLICY_NAME = 'laurel-generated-response-headers';

const REFERRER_POLICIES = new Set([
  'no-referrer',
  'no-referrer-when-downgrade',
  'origin',
  'origin-when-cross-origin',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
]);

interface CloudFrontResponseHeadersPolicyConfig {
  Name: string;
  Comment: string;
  SecurityHeadersConfig?: CloudFrontSecurityHeadersConfig;
  CustomHeadersConfig?: CloudFrontCustomHeadersConfig;
}

interface CloudFrontSecurityHeadersConfig {
  ContentSecurityPolicy?: {
    ContentSecurityPolicy: string;
    Override: boolean;
  };
  ContentTypeOptions?: {
    Override: boolean;
  };
  FrameOptions?: {
    FrameOption: 'DENY' | 'SAMEORIGIN';
    Override: boolean;
  };
  ReferrerPolicy?: {
    ReferrerPolicy: string;
    Override: boolean;
  };
  StrictTransportSecurity?: {
    AccessControlMaxAgeSec: number;
    IncludeSubdomains: boolean;
    Preload: boolean;
    Override: boolean;
  };
}

interface CloudFrontCustomHeadersConfig {
  Quantity: number;
  Items: CloudFrontCustomHeader[];
}

interface CloudFrontCustomHeader {
  Header: string;
  Value: string;
  Override: boolean;
}

interface HstsParts {
  maxAge: number | undefined;
  includeSubDomains: boolean;
  preload: boolean;
}

function parseHsts(value: string): HstsParts {
  const parts: HstsParts = {
    maxAge: undefined,
    includeSubDomains: false,
    preload: false,
  };

  for (const rawDirective of value.split(';')) {
    const directive = rawDirective.trim();
    const normalized = directive.toLowerCase();
    if (normalized === '') continue;
    if (normalized === 'includesubdomains') {
      parts.includeSubDomains = true;
      continue;
    }
    if (normalized === 'preload') {
      parts.preload = true;
      continue;
    }
    if (normalized.startsWith('max-age=')) {
      const raw = normalized.slice('max-age='.length).replace(/"/g, '').trim();
      const maxAge = Number.parseInt(raw, 10);
      if (Number.isFinite(maxAge) && maxAge >= 0) parts.maxAge = maxAge;
    }
  }

  return parts;
}

function addCustomHeader(items: CloudFrontCustomHeader[], header: string, value: string): void {
  items.push({ Header: header, Value: value, Override: true });
}

function hasSecurityHeaders(config: CloudFrontSecurityHeadersConfig): boolean {
  return Object.keys(config).length > 0;
}

export function buildCloudFrontResponseHeadersPolicy(
  headers: HeadersConfig,
): CloudFrontResponseHeadersPolicyConfig {
  const security: CloudFrontSecurityHeadersConfig = {};
  const customHeaders: CloudFrontCustomHeader[] = [];
  const source = headers.security;

  if (typeof source.content_type_options === 'string' && source.content_type_options.length > 0) {
    if (source.content_type_options.toLowerCase() === 'nosniff') {
      security.ContentTypeOptions = { Override: true };
    } else {
      addCustomHeader(customHeaders, 'X-Content-Type-Options', source.content_type_options);
    }
  }

  if (typeof source.frame_options === 'string' && source.frame_options.length > 0) {
    const frameOption = source.frame_options.toUpperCase();
    if (frameOption === 'DENY' || frameOption === 'SAMEORIGIN') {
      security.FrameOptions = { FrameOption: frameOption, Override: true };
    } else {
      addCustomHeader(customHeaders, 'X-Frame-Options', source.frame_options);
    }
  }

  if (typeof source.referrer_policy === 'string' && source.referrer_policy.length > 0) {
    const referrerPolicy = source.referrer_policy.toLowerCase();
    if (REFERRER_POLICIES.has(referrerPolicy)) {
      security.ReferrerPolicy = { ReferrerPolicy: referrerPolicy, Override: true };
    } else {
      addCustomHeader(customHeaders, 'Referrer-Policy', source.referrer_policy);
    }
  }

  if (
    typeof source.strict_transport_security === 'string' &&
    source.strict_transport_security.length > 0
  ) {
    const hstsValue = validateHstsForPreload(source.strict_transport_security);
    const hsts = parseHsts(hstsValue);
    if (hsts.maxAge !== undefined) {
      security.StrictTransportSecurity = {
        AccessControlMaxAgeSec: hsts.maxAge,
        IncludeSubdomains: hsts.includeSubDomains,
        Preload: hsts.preload,
        Override: true,
      };
    } else {
      addCustomHeader(customHeaders, 'Strict-Transport-Security', hstsValue);
    }
  }

  if (
    typeof source.content_security_policy === 'string' &&
    source.content_security_policy.length > 0
  ) {
    security.ContentSecurityPolicy = {
      ContentSecurityPolicy: source.content_security_policy,
      Override: true,
    };
  }

  if (typeof source.permissions_policy === 'string' && source.permissions_policy.length > 0) {
    addCustomHeader(customHeaders, 'Permissions-Policy', source.permissions_policy);
  }

  if (
    typeof source.cross_origin_opener_policy === 'string' &&
    source.cross_origin_opener_policy.length > 0
  ) {
    addCustomHeader(customHeaders, 'Cross-Origin-Opener-Policy', source.cross_origin_opener_policy);
  }

  if (
    typeof source.cross_origin_embedder_policy === 'string' &&
    source.cross_origin_embedder_policy.length > 0
  ) {
    addCustomHeader(
      customHeaders,
      'Cross-Origin-Embedder-Policy',
      source.cross_origin_embedder_policy,
    );
  }

  for (const [name, value] of Object.entries(source.custom)) {
    if (typeof value === 'string' && value.length > 0) {
      addCustomHeader(customHeaders, name, value);
    }
  }

  const policy: CloudFrontResponseHeadersPolicyConfig = {
    Name: DEFAULT_POLICY_NAME,
    Comment:
      'Generated by Laurel from [deploy.headers].security. Attach to CloudFront cache behaviors; keep cache_rules in S3 metadata or CloudFront cache policies.',
  };

  if (hasSecurityHeaders(security)) {
    policy.SecurityHeadersConfig = security;
  }
  if (customHeaders.length > 0) {
    policy.CustomHeadersConfig = {
      Quantity: customHeaders.length,
      Items: customHeaders,
    };
  }

  return policy;
}

export async function emitCloudFrontResponseHeadersPolicy(opts: {
  outputDir: string;
  headers: HeadersConfig;
}): Promise<void> {
  const dir = join(opts.outputDir, '.laurel');
  await ensureDir(dir);
  await writeFile(
    join(dir, CLOUDFRONT_RESPONSE_HEADERS_POLICY_FILE),
    `${JSON.stringify(buildCloudFrontResponseHeadersPolicy(opts.headers), null, 2)}\n`,
  );
}
