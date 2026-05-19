import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NectarConfig } from '~/config/schema.ts';
import { ensureDir } from '~/util/fs.ts';

export type HeadersConfig = NectarConfig['deploy']['headers'];

// Cloudflare Pages and Netlify both read `_headers` at the publish-dir root
// with the same syntax (a URL pattern on its own line, then any number of
// two-space-indented `Header-Name: value` lines, rules separated by a blank
// line). Both use first-match for cache rules, so the catch-all `/*` rule
// must come last or it shadows more specific patterns and the cacheability of
// fingerprinted asset URLs is lost.
//
// Headers are sourced from `deploy.headers` (see `src/config/schema.ts`):
// `cache_rules` defines URL-pattern → Cache-Control mappings, and `security`
// defines named headers attached to the catch-all rule so site-wide policy
// lives in one place instead of being duplicated per pattern.
const CATCH_ALL = '/*';

const SECURITY_HEADER_FIELDS: ReadonlyArray<{
  key: keyof Omit<HeadersConfig['security'], 'custom'>;
  name: string;
}> = [
  { key: 'content_type_options', name: 'X-Content-Type-Options' },
  { key: 'frame_options', name: 'X-Frame-Options' },
  { key: 'referrer_policy', name: 'Referrer-Policy' },
  { key: 'strict_transport_security', name: 'Strict-Transport-Security' },
  { key: 'content_security_policy', name: 'Content-Security-Policy' },
  { key: 'permissions_policy', name: 'Permissions-Policy' },
  { key: 'cross_origin_opener_policy', name: 'Cross-Origin-Opener-Policy' },
  { key: 'cross_origin_embedder_policy', name: 'Cross-Origin-Embedder-Policy' },
];

interface Rule {
  pattern: string;
  lines: string[];
}

export function buildHeadersBody(headers: HeadersConfig): string {
  const rules = collectRules(headers);
  if (rules.length === 0) return '';
  return `${rules
    .map(({ pattern, lines }) => `${pattern}\n${lines.map((line) => `  ${line}`).join('\n')}`)
    .join('\n\n')}\n`;
}

function collectRules(headers: HeadersConfig): Rule[] {
  const securityLines = collectSecurityLines(headers.security);
  const seen = new Set<string>();
  const ordered: Rule[] = [];
  let catchAll: Rule | null = null;

  for (const rule of headers.cache_rules) {
    if (seen.has(rule.pattern)) continue;
    seen.add(rule.pattern);
    const entry: Rule = {
      pattern: rule.pattern,
      lines: [`Cache-Control: ${rule.cache_control}`],
    };
    if (rule.pattern === CATCH_ALL) {
      catchAll = entry;
    } else {
      ordered.push(entry);
    }
  }

  if (!catchAll && securityLines.length > 0) {
    catchAll = { pattern: CATCH_ALL, lines: [] };
  }
  if (catchAll) {
    catchAll.lines.push(...securityLines);
    ordered.push(catchAll);
  }

  return ordered;
}

function collectSecurityLines(security: HeadersConfig['security']): string[] {
  const lines: string[] = [];
  for (const { key, name } of SECURITY_HEADER_FIELDS) {
    const value = security[key];
    if (typeof value === 'string' && value.length > 0) {
      lines.push(`${name}: ${value}`);
    }
  }
  for (const [name, value] of Object.entries(security.custom)) {
    if (typeof value === 'string' && value.length > 0) {
      lines.push(`${name}: ${value}`);
    }
  }
  return lines;
}

export async function writeHeadersFile(opts: {
  outputDir: string;
  enabled: boolean;
  headers: HeadersConfig;
}): Promise<void> {
  if (!opts.enabled) return;
  await ensureDir(opts.outputDir);
  await writeFile(join(opts.outputDir, '_headers'), buildHeadersBody(opts.headers));
}
