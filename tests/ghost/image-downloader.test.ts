import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GhostImageDownloader } from '~/ghost/image-downloader.ts';

describe('GhostImageDownloader', () => {
  test('serializes concurrent image downloads through one shared downloader', async () => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-image-dl-serial-')));
    const urls = [
      'https://example.com/content/images/2026/05/a.jpg',
      'https://example.com/content/images/2026/05/b.jpg',
      'https://example.com/content/images/2026/05/c.jpg',
    ];
    let activeFetches = 0;
    let maxActiveFetches = 0;
    const fetcher = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      activeFetches += 1;
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
      await Bun.sleep(20);
      activeFetches -= 1;
      return new Response(`bytes:${url}`, {
        headers: { 'content-type': 'image/jpeg' },
      });
    }) as typeof fetch;

    try {
      const downloader = new GhostImageDownloader({ cwd, fetcher });

      const rewritten = await Promise.all(urls.map((url) => downloader.downloadOne(url)));

      expect(rewritten).toEqual([
        '/content/images/2026/05/a.jpg',
        '/content/images/2026/05/b.jpg',
        '/content/images/2026/05/c.jpg',
      ]);
      expect(maxActiveFetches).toBe(1);
      expect(await readFile(join(cwd, 'content/images/2026/05/a.jpg'), 'utf8')).toBe(
        `bytes:${urls[0]}`,
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('reads response bodies as streams without using response.arrayBuffer()', async () => {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-image-dl-stream-')));
    const url = 'https://example.com/content/images/2026/05/streamed.jpg';
    const fetcher = (async (): Promise<Response> => {
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('streamed '));
            controller.enqueue(new TextEncoder().encode('bytes'));
            controller.close();
          },
        }),
        { headers: { 'content-type': 'image/jpeg' } },
      );
      response.arrayBuffer = async () => {
        throw new Error('arrayBuffer should not be used');
      };
      return response;
    }) as typeof fetch;

    try {
      const downloader = new GhostImageDownloader({ cwd, fetcher });

      const rewritten = await downloader.downloadOne(url);

      expect(rewritten).toBe('/content/images/2026/05/streamed.jpg');
      expect(await readFile(join(cwd, 'content/images/2026/05/streamed.jpg'), 'utf8')).toBe(
        'streamed bytes',
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
