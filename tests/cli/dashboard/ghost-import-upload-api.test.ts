import { afterEach, describe, expect, test } from 'bun:test';
import { setDashboardToken, streamGhostImport } from '~/cli/dashboard/web/lib/api.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function doneResponse(): Response {
  return new Response(
    `${JSON.stringify({
      type: 'done',
      mode: 'apply',
      target: 'content/',
      summary: { posts: 0 },
    })}\n`,
    { headers: { 'content-type': 'application/x-ndjson' } },
  );
}

describe('streamGhostImport', () => {
  test('does not request image downloads when Source URL is blank', async () => {
    let submitted: FormData | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      submitted = init?.body instanceof FormData ? init.body : undefined;
      return doneResponse();
    }) as typeof fetch;

    setDashboardToken('test-token');
    await streamGhostImport(
      {
        file: new File([new Uint8Array([1])], 'ghost-export.json', { type: 'application/json' }),
        onConflict: 'skip',
      },
      () => {},
    );

    expect(submitted?.get('sourceUrl')).toBeNull();
    expect(submitted?.get('downloadImages')).toBeNull();
  });

  test('requests image downloads when Source URL is provided', async () => {
    let submitted: FormData | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      submitted = init?.body instanceof FormData ? init.body : undefined;
      return doneResponse();
    }) as typeof fetch;

    setDashboardToken('test-token');
    await streamGhostImport(
      {
        file: new File([new Uint8Array([1])], 'ghost-export.json', { type: 'application/json' }),
        onConflict: 'skip',
        sourceUrl: 'https://oldblog.com',
      },
      () => {},
    );

    expect(submitted?.get('sourceUrl')).toBe('https://oldblog.com');
    expect(submitted?.get('downloadImages')).toBe('true');
  });
});
