import { createHash } from 'node:crypto';
import { Parser } from 'htmlparser2';
import type { HeadersConfig } from './headers.ts';

export function inlineScriptCspHash(body: string): string {
  return `sha256-${createHash('sha256').update(body).digest('base64')}`;
}

export function collectInlineScriptCspHashes(html: string): string[] {
  const hashes = new Set<string>();
  let inInlineScript = false;
  let body = '';

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name !== 'script') return;
        if (typeof attrs.src === 'string' && attrs.src.length > 0) return;
        inInlineScript = true;
        body = '';
      },
      ontext(text) {
        if (inInlineScript) body += text;
      },
      onclosetag(name) {
        if (name !== 'script' || !inInlineScript) return;
        if (body.trim().length > 0) hashes.add(inlineScriptCspHash(body));
        inInlineScript = false;
        body = '';
      },
    },
    {
      decodeEntities: false,
      lowerCaseAttributeNames: true,
      lowerCaseTags: true,
      recognizeSelfClosing: true,
    },
  );

  parser.write(html);
  parser.end();
  return [...hashes].sort();
}

export function addInlineScriptHashesToCsp(csp: string, hashes: Iterable<string>): string {
  const hashSources = normalizeHashSources(hashes);
  if (hashSources.length === 0) return csp;

  const directives = parseCsp(csp);
  const scriptSrc = directives.find((d) => d.name.toLowerCase() === 'script-src');
  const scriptSrcElem = directives.find((d) => d.name.toLowerCase() === 'script-src-elem');

  if (scriptSrc) {
    appendMissingSources(scriptSrc.values, hashSources);
  } else {
    const defaultSrc = directives.find((d) => d.name.toLowerCase() === 'default-src');
    const values = defaultSrc ? [...defaultSrc.values] : [];
    appendMissingSources(values, hashSources);
    directives.push({ name: 'script-src', values });
  }

  if (scriptSrcElem) {
    appendMissingSources(scriptSrcElem.values, hashSources);
  }

  return directives.map((d) => [d.name, ...d.values].join(' ')).join('; ');
}

export function withInlineScriptCspHashes(
  headers: HeadersConfig,
  hashes: Iterable<string>,
): HeadersConfig {
  const csp = headers.security.content_security_policy;
  if (typeof csp !== 'string' || csp.length === 0) return headers;

  const nextCsp = addInlineScriptHashesToCsp(csp, hashes);
  if (nextCsp === csp) return headers;
  return {
    ...headers,
    security: {
      ...headers.security,
      content_security_policy: nextCsp,
    },
  };
}

interface CspDirective {
  name: string;
  values: string[];
}

function parseCsp(csp: string): CspDirective[] {
  return csp
    .split(';')
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw) => {
      const [name = '', ...values] = raw.split(/\s+/);
      return { name, values };
    })
    .filter((d) => d.name.length > 0);
}

function normalizeHashSources(hashes: Iterable<string>): string[] {
  const sources = new Set<string>();
  for (const hash of hashes) {
    const unquoted = hash.trim().replace(/^'|'$/g, '');
    if (/^sha(256|384|512)-[A-Za-z0-9+/]+=*$/.test(unquoted)) {
      sources.add(`'${unquoted}'`);
    }
  }
  return [...sources].sort();
}

function appendMissingSources(values: string[], sources: readonly string[]): void {
  const existing = new Set(values);
  for (const source of sources) {
    if (!existing.has(source)) {
      values.push(source);
      existing.add(source);
    }
  }
}
