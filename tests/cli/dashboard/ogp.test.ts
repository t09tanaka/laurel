import { describe, expect, test } from 'bun:test';
import {
  type FetchOgpOptions,
  classifyHost,
  classifyResolvedIp,
  pickMetadata,
} from '../../../src/cli/dashboard/ogp.ts';

const FULL_HTML = `
<!doctype html><html><head>
<title>Fallback Title</title>
<meta name="description" content="Plain description.">
<meta name="author" content="Jane Doe">
<meta property="og:title" content="OG Title">
<meta property="og:description" content="OG description.">
<meta property="og:site_name" content="Example Publisher">
<meta property="og:image" content="https://cdn.example.com/cover.png">
<meta property="og:image:secure_url" content="https://cdn.example.com/cover-secure.png">
<link rel="icon" href="/favicon-32.png" sizes="32x32">
<link rel="icon" href="/favicon-64.png" sizes="64x64">
</head><body></body></html>
`;

describe('pickMetadata', () => {
  test('prefers og:image:secure_url, og:title, og:description, og:site_name', () => {
    const meta = pickMetadata(FULL_HTML, new URL('https://example.com/post'));
    expect(meta.title).toBe('OG Title');
    expect(meta.description).toBe('OG description.');
    expect(meta.publisher).toBe('Example Publisher');
    expect(meta.thumbnail).toBe('https://cdn.example.com/cover-secure.png');
    expect(meta.author).toBe('Jane Doe');
  });

  test('picks the largest icon by sizes attribute', () => {
    const meta = pickMetadata(FULL_HTML, new URL('https://example.com/post'));
    expect(meta.icon).toBe('https://example.com/favicon-64.png');
  });

  test('falls back to <title> and meta description when og:* missing', () => {
    const html = `<html><head><title>Just Title</title><meta name="description" content="d"></head></html>`;
    const meta = pickMetadata(html, new URL('https://example.com/x'));
    expect(meta.title).toBe('Just Title');
    expect(meta.description).toBe('d');
  });

  test('falls back to twitter:* when both og:* and bare tags missing', () => {
    const html = `<html><head><meta name="twitter:title" content="T"><meta name="twitter:description" content="D"><meta name="twitter:image" content="https://cdn/x.png"></head></html>`;
    const meta = pickMetadata(html, new URL('https://example.com/'));
    expect(meta.title).toBe('T');
    expect(meta.description).toBe('D');
    expect(meta.thumbnail).toBe('https://cdn/x.png');
  });

  test('falls back to URL hostname as publisher and /favicon.ico as icon', () => {
    const html = '<html><head><title>x</title></head></html>';
    const meta = pickMetadata(html, new URL('https://news.example.org/a'));
    expect(meta.publisher).toBe('news.example.org');
    expect(meta.icon).toBe('https://news.example.org/favicon.ico');
  });

  test('truncates each text field to 300 chars and trims whitespace', () => {
    const long = 'a'.repeat(500);
    const html = `<html><head><title>  ${long}  </title></head></html>`;
    const meta = pickMetadata(html, new URL('https://example.com/'));
    expect(meta.title.length).toBe(300);
    expect(meta.title.startsWith('a')).toBe(true);
  });

  test('resolves relative thumbnail URLs against the final URL', () => {
    const html = `<html><head><meta property="og:image" content="/cover.png"></head></html>`;
    const meta = pickMetadata(html, new URL('https://blog.example.com/post/'));
    expect(meta.thumbnail).toBe('https://blog.example.com/cover.png');
  });
});

describe('classifyHost', () => {
  test('blocks localhost variants', () => {
    expect(classifyHost('localhost')).toBe('blocked');
    expect(classifyHost('foo.localhost')).toBe('blocked');
    expect(classifyHost('bar.local')).toBe('blocked');
    expect(classifyHost('svc.internal')).toBe('blocked');
  });

  test('allows ordinary public hostnames', () => {
    expect(classifyHost('example.com')).toBe('public');
    expect(classifyHost('news.example.org')).toBe('public');
  });

  test('blocks literal loopback / private / link-local / metadata IPv4', () => {
    for (const ip of [
      '127.0.0.1',
      '127.7.7.7',
      '0.0.0.0',
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
    ]) {
      expect(classifyHost(ip)).toBe('blocked');
    }
  });

  test('blocks literal loopback / unique-local / link-local IPv6', () => {
    for (const ip of ['::1', 'fc00::1', 'fd12::1', 'fe80::1', '::', '::ffff:127.0.0.1']) {
      expect(classifyHost(ip)).toBe('blocked');
    }
  });

  test('allows literal public IPv4 / IPv6', () => {
    expect(classifyHost('8.8.8.8')).toBe('public');
    expect(classifyHost('2606:4700:4700::1111')).toBe('public');
  });

  test('blocks hostnames with a trailing FQDN dot', () => {
    expect(classifyHost('localhost.')).toBe('blocked');
    expect(classifyHost('foo.localhost.')).toBe('blocked');
    expect(classifyHost('bar.local.')).toBe('blocked');
  });
});

describe('classifyResolvedIp', () => {
  test('mirrors classifyHost for literal IPs', () => {
    expect(classifyResolvedIp('127.0.0.1')).toBe('blocked');
    expect(classifyResolvedIp('192.168.0.5')).toBe('blocked');
    expect(classifyResolvedIp('169.254.169.254')).toBe('blocked');
    expect(classifyResolvedIp('fc00::1')).toBe('blocked');
    expect(classifyResolvedIp('8.8.8.8')).toBe('public');
  });
});

import { fetchOgp } from '../../../src/cli/dashboard/ogp.ts';

function htmlResponse(body: string, status = 200, contentType = 'text/html; charset=utf-8') {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

function makeOpts(overrides: Partial<FetchOgpOptions> = {}): FetchOgpOptions {
  return {
    fetch: async () => htmlResponse(''),
    timeoutMs: 50,
    maxBytes: 1024 * 1024,
    maxRedirects: 3,
    lookup: async () => '8.8.8.8',
    ...overrides,
  };
}

describe('fetchOgp', () => {
  test('returns ok=false with invalid_url for non-http schemes', async () => {
    const r = await fetchOgp(
      'javascript:alert(1)',
      makeOpts({ fetch: async () => htmlResponse('') }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_url');
  });

  test('returns ok=false with blocked for localhost hostnames', async () => {
    const r = await fetchOgp(
      'http://localhost/x',
      makeOpts({ fetch: async () => htmlResponse('') }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('blocked');
  });

  test('returns ok=false with blocked when DNS resolves to private IP', async () => {
    const r = await fetchOgp(
      'http://example.com/',
      makeOpts({ lookup: async () => '127.0.0.1', fetch: async () => htmlResponse('') }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('blocked');
  });

  test('returns ok=true with meta from successful response', async () => {
    const html = `<html><head><meta property="og:title" content="X"></head></html>`;
    const r = await fetchOgp(
      'https://example.com/',
      makeOpts({ fetch: async () => htmlResponse(html) }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.meta.title).toBe('X');
  });

  test('returns no_metadata when content-type is not text/html', async () => {
    const r = await fetchOgp(
      'https://example.com/',
      makeOpts({ fetch: async () => htmlResponse('{}', 200, 'application/json') }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no_metadata');
  });

  test('follows redirect, re-checks host on each hop', async () => {
    let calls = 0;
    const fetcher = async (url: string) => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://final.example.com/' },
        });
      }
      return htmlResponse(`<html><head><title>${url}</title></head></html>`);
    };
    const r = await fetchOgp('https://start.example.com/', makeOpts({ fetch: fetcher }));
    expect(calls).toBe(2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.meta.title).toBe('https://final.example.com/');
  });

  test('blocks redirect target that resolves to a private IP', async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://internal.evil/' },
        });
      }
      return htmlResponse('<html></html>');
    };
    const lookup = async (host: string) => (host === 'internal.evil' ? '10.0.0.1' : '8.8.8.8');
    const r = await fetchOgp('https://start.example.com/', makeOpts({ fetch: fetcher, lookup }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('blocked');
  });

  test('caps total redirects', async () => {
    const fetcher = async () =>
      new Response(null, { status: 302, headers: { location: 'https://next.example.com/' } });
    const r = await fetchOgp(
      'https://start.example.com/',
      makeOpts({ fetch: fetcher, maxRedirects: 2 }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('fetch_failed');
  });

  test('returns timeout when fetch throws AbortError', async () => {
    const fetcher = async () => {
      const e: Error & { name?: string } = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    };
    const r = await fetchOgp('https://example.com/', makeOpts({ fetch: fetcher }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('timeout');
  });
});
