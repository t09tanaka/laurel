import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { buildHeadersBody } from '~/build/headers.ts';
import {
  addInlineScriptHashesToCsp,
  collectInlineScriptCspHashes,
  inlineScriptCspHash,
  withInlineScriptCspHashes,
} from '~/build/inline-script-csp.ts';
import { configSchema } from '~/config/schema.ts';

function cspHash(body: string): string {
  return `sha256-${createHash('sha256').update(body).digest('base64')}`;
}

function parseHeaders(contentSecurityPolicy: string) {
  return configSchema.parse({
    site: { title: 'x' },
    deploy: {
      headers: {
        security: {
          content_security_policy: contentSecurityPolicy,
        },
      },
    },
  }).deploy.headers;
}

describe('collectInlineScriptCspHashes', () => {
  test('hashes inline script bodies and ignores external scripts', () => {
    const body = "window.laurel = 'ok';";
    const html = `<html><head><script>${body}</script><script src="/assets/app.js"></script></head></html>`;

    expect(collectInlineScriptCspHashes(html)).toEqual([cspHash(body)]);
  });

  test('deduplicates repeated inline script bodies', () => {
    const body = "console.log('same');";
    const html = `<script>${body}</script><main></main><script>${body}</script>`;

    expect(collectInlineScriptCspHashes(html)).toEqual([inlineScriptCspHash(body)]);
  });

  test('skips empty inline script bodies', () => {
    expect(collectInlineScriptCspHashes('<script> \n </script>')).toEqual([]);
  });
});

describe('addInlineScriptHashesToCsp', () => {
  test('appends hashes to an existing script-src directive', () => {
    const hash = cspHash("console.log('x');");

    expect(addInlineScriptHashesToCsp("default-src 'self'; script-src 'self'", [hash])).toBe(
      `default-src 'self'; script-src 'self' '${hash}'`,
    );
  });

  test('creates script-src from default-src when script-src is absent', () => {
    const hash = cspHash('window.__LAUREL__=true;');

    expect(addInlineScriptHashesToCsp("default-src 'self'; object-src 'none'", [hash])).toBe(
      `default-src 'self'; object-src 'none'; script-src 'self' '${hash}'`,
    );
  });

  test('also appends hashes to script-src-elem when it is configured', () => {
    const hash = cspHash('window.__LAUREL__=true;');

    expect(
      addInlineScriptHashesToCsp("default-src 'self'; script-src 'self'; script-src-elem 'self'", [
        hash,
      ]),
    ).toBe(`default-src 'self'; script-src 'self' '${hash}'; script-src-elem 'self' '${hash}'`);
  });

  test('does not duplicate existing hash sources', () => {
    const hash = cspHash("console.log('x');");
    const csp = `default-src 'self'; script-src 'self' '${hash}'`;

    expect(addInlineScriptHashesToCsp(csp, [hash])).toBe(csp);
  });
});

describe('withInlineScriptCspHashes', () => {
  test('feeds computed hashes through shared header emission', () => {
    const hash = cspHash('window.portal = {};');
    const headers = withInlineScriptCspHashes(parseHeaders("default-src 'self'"), [hash]);
    const body = buildHeadersBody(headers);

    expect(body).toContain(
      `Content-Security-Policy: default-src 'self'; script-src 'self' '${hash}'`,
    );
  });

  test('leaves headers unchanged when no CSP is configured', () => {
    const headers = configSchema.parse({ site: { title: 'x' } }).deploy.headers;

    expect(withInlineScriptCspHashes(headers, [cspHash('x')])).toBe(headers);
  });
});
