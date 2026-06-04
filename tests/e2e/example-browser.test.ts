import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join, resolve, sep } from 'node:path';
import { type LaunchedChrome, launch } from 'chrome-launcher';
import puppeteer, { type Browser } from 'puppeteer-core';
import { build } from '~/build/pipeline.ts';

const cwd = join(process.cwd(), 'example');
const distRoot = join(cwd, 'dist');
const routes = ['/', '/hello-laurel/', '/about/', '/tag/news/', '/author/casper/', '/page/2/'];
const BROWSER_SMOKE_TIMEOUT_MS = 60_000;

let server: ReturnType<typeof Bun.serve> | undefined;
let chrome: LaunchedChrome | undefined;
let browser: Browser | undefined;

describe('example browser smoke', () => {
  beforeAll(async () => {
    await build({ cwd });
    server = serveDist();
    chrome = await launch({
      chromeFlags: [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${chrome.port}`,
    });
  }, BROWSER_SMOKE_TIMEOUT_MS);

  afterAll(async () => {
    await browser?.close().catch(() => undefined);
    chrome?.kill();
    server?.stop(true);
  });

  test(
    'loads representative built pages without browser runtime errors',
    async () => {
      if (!browser || !server) throw new Error('browser smoke test did not initialize');

      for (const route of routes) {
        const page = await browser.newPage();
        const failures: string[] = [];
        page.on('pageerror', (error) => failures.push(`pageerror: ${errorMessage(error)}`));
        page.on('console', (message) => {
          if (message.type() === 'error') failures.push(`console error: ${message.text()}`);
        });
        page.on('response', (response) => {
          if (!response.ok() && isLocalAssetResponse(response.url())) {
            failures.push(`HTTP ${response.status()}: ${response.url()}`);
          }
        });

        try {
          const response = await page.goto(`${origin(server)}${route}`, {
            waitUntil: 'networkidle0',
            timeout: 15_000,
          });
          expect(response?.ok(), `${route} should return a successful document response`).toBe(
            true,
          );
          await expectVisiblePage(page, route);
          expect(failures, `${route} should load without browser runtime errors`).toEqual([]);
        } finally {
          await page.close();
        }
      }
    },
    BROWSER_SMOKE_TIMEOUT_MS,
  );
});

function serveDist(): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      let pathname: string;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return new Response('Bad request', { status: 400 });
      }

      const requested = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
      const candidate = resolve(distRoot, `.${requested}`);
      const distPrefix = distRoot.endsWith(sep) ? distRoot : `${distRoot}${sep}`;
      if (candidate !== distRoot && !candidate.startsWith(distPrefix)) {
        return new Response('Not found', { status: 404 });
      }

      const file = Bun.file(candidate);
      if (!(await file.exists())) return new Response('Not found', { status: 404 });
      return new Response(file, { headers: { 'Content-Type': contentType(candidate) } });
    },
  });
}

function origin(activeServer: ReturnType<typeof Bun.serve>): string {
  return `http://${activeServer.hostname}:${activeServer.port}`;
}

async function expectVisiblePage(page: Awaited<ReturnType<Browser['newPage']>>, route: string) {
  const title = await page.title();
  expect(title.trim().length, `${route} should render a document title`).toBeGreaterThan(0);

  const main = await page.$('main');
  if (!main) {
    const body = await page.evaluate(() => {
      const runtime = globalThis as typeof globalThis & {
        document?: { body?: { textContent?: string | null } };
      };
      return runtime.document?.body?.textContent?.slice(0, 500) ?? '';
    });
    throw new Error(`${route} rendered without a <main> landmark. Body starts with: ${body}`);
  }

  const mainText = await main.evaluate((element) => element.textContent?.trim() ?? '');
  expect(mainText.length, `${route} should render visible main content`).toBeGreaterThan(20);

  const viewport = await page.$eval('.viewport', (element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(viewport.width, `${route} should lay out the viewport`).toBeGreaterThan(300);
  expect(viewport.height, `${route} should lay out page content`).toBeGreaterThan(300);
}

function isLocalAssetResponse(url: string): boolean {
  return /^https?:\/\/(?:127\.0\.0\.1|\[::1\]|localhost)(?::\d+)?\//.test(url);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function contentType(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.json') || path.endsWith('.webmanifest')) {
    return 'application/json; charset=utf-8';
  }
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.woff2')) return 'font/woff2';
  if (path.endsWith('.xml')) return 'application/xml; charset=utf-8';
  return 'application/octet-stream';
}
