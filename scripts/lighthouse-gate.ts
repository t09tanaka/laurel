import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import {
  formatLighthouseFailures,
  selectLighthouseTargets,
  summarizeLighthouseReport,
  type LighthouseJsonReport,
  type LighthouseTarget,
} from '~/build/lighthouse-quality.ts';
import { parseFrontmatter } from '~/content/frontmatter.ts';

const repoRoot = resolve(import.meta.dir, '..');
const distRoot = resolve(repoRoot, 'example/dist');
const postsRoot = resolve(repoRoot, 'example/content/posts');
const reportRoot = resolve(distRoot, '.nectar/lighthouse');
const maxUrls = Number(process.env.NECTAR_LIGHTHOUSE_MAX_URLS ?? '8');

async function collectHtmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        return collectHtmlFiles(path);
      }
      return entry.isFile() && entry.name.endsWith('.html') ? [path] : [];
    }),
  );
  return files.flat().sort();
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        return collectMarkdownFiles(path);
      }
      return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
    }),
  );
  return files.flat().sort();
}

async function collectBlogArticleRoutes(): Promise<string[]> {
  const files = await collectMarkdownFiles(postsRoot);
  const posts = await Promise.all(
    files.map(async (file) => {
      const raw = await Bun.file(file).text();
      const parsed = parseFrontmatter(raw, { filePath: file });
      const slug =
        typeof parsed.data.slug === 'string' && parsed.data.slug.trim()
          ? parsed.data.slug.trim()
          : basename(file, '.md');
      const createdAt = String(parsed.data.created_at ?? parsed.data.date ?? '');
      return { route: `/${slug}/`, createdAt };
    }),
  );
  return [
    '/',
    ...posts
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((post) => post.route),
  ];
}

async function serveDist(): Promise<ReturnType<typeof Bun.serve>> {
  return Bun.serve({
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
      if (candidate !== distRoot && !candidate.startsWith(`${distRoot}/`)) {
        return new Response('Not found', { status: 404 });
      }

      const file = Bun.file(candidate);
      if (!(await file.exists())) {
        return new Response('Not found', { status: 404 });
      }
      if (candidate.endsWith('.html')) {
        const html = await file.text();
        return new Response(rewriteLocalOrigins(html, url.origin), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return new Response(file);
    },
  });
}

function rewriteLocalOrigins(html: string, origin: string): string {
  return html.replaceAll('https://nectar.example.com', origin);
}

async function runLighthouse(target: LighthouseTarget): Promise<LighthouseJsonReport> {
  const reportPath = resolve(reportRoot, reportName(target.route));
  const proc = Bun.spawn({
    cmd: [
      process.execPath,
      'x',
      'lighthouse',
      target.url,
      '--quiet',
      '--preset=desktop',
      '--only-categories=performance,accessibility,best-practices,seo',
      '--output=json',
      `--output-path=${reportPath}`,
      '--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu',
    ],
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, CI: '1' },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `Lighthouse failed for ${target.url} with exit code ${code}\n${stderr.trim()}\n${stdout.trim()}`,
    );
  }
  return JSON.parse(await Bun.file(reportPath).text()) as LighthouseJsonReport;
}

function reportName(route: string): string {
  const safe = route === '/' ? 'home' : route.replace(/^\/|\/$/g, '').replace(/[^a-z0-9-]+/gi, '-');
  return `${safe || 'page'}.json`;
}

async function main(): Promise<void> {
  const files = await collectHtmlFiles(distRoot).catch((error) => {
    throw new Error(
      `example/dist is not ready for Lighthouse. Run "bun run build:example" first.\n${(error as Error).message}`,
    );
  });
  if (files.length === 0) {
    throw new Error('example/dist contains no HTML files. Run "bun run build:example" first.');
  }

  await rm(reportRoot, { recursive: true, force: true });
  await mkdir(reportRoot, { recursive: true });
  await writeFile(resolve(reportRoot, '.keep'), '', 'utf8');

  const server = await serveDist();
  try {
    const origin = `http://${server.hostname}:${server.port}`;
    const routeOrder = await collectBlogArticleRoutes();
    const includeRoutes = new Set(routeOrder);
    const targets = selectLighthouseTargets(files, {
      distRoot,
      origin,
      maxUrls: Number.isFinite(maxUrls) ? maxUrls : 8,
      includeRoutes,
      routeOrder,
    });
    const summaries = [];
    for (const target of targets) {
      const report = await runLighthouse(target);
      summaries.push(summarizeLighthouseReport(report));
    }
    const failures = formatLighthouseFailures(summaries);
    if (failures) {
      console.error('Lighthouse gate failed. Every measured category must be 100.');
      console.error(failures);
      console.error(`Reports: ${relative(repoRoot, reportRoot)}`);
      process.exit(1);
    }
    console.log(`Lighthouse gate passed: ${targets.length} page(s), all categories scored 100.`);
  } finally {
    server.stop(true);
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
