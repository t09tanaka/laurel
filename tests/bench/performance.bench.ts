import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BuildSummary, build } from '~/build/pipeline.ts';
import type { BuildStats } from '~/build/profile.ts';

const DEFAULT_POST_COUNT = 1000;
const postCount = readPositiveInt(Bun.env.LAUREL_BENCH_POSTS, DEFAULT_POST_COUNT);
const keepSite = Bun.env.LAUREL_BENCH_KEEP === '1';

interface BenchResult {
  name: string;
  durationMs: number;
  summary: BuildSummary;
  renderAverage: string;
}

async function main(): Promise<void> {
  const cwd = await makeBenchSite(postCount);

  try {
    const full = await measure('full build', () => build({ cwd, profile: true }));
    const unchanged = await measure('incremental unchanged', () => build({ cwd, profile: true }));

    const editedPost = Math.min(420, postCount);
    await writeFile(
      join(cwd, `content/posts/post-${pad(editedPost)}.md`),
      postMarkdown(editedPost, 'Updated benchmark body for the incremental edit case.'),
      'utf8',
    );

    const edited = await measure('incremental one-post edit', () => build({ cwd, profile: true }));

    printResults([full, unchanged, edited]);

    if (full.durationMs >= 3000 && postCount >= 1000) {
      console.log(
        `\nwarning: full build missed the <3s target (${formatMs(full.durationMs)} for ${postCount} posts)`,
      );
    }
  } finally {
    if (keepSite) console.log(`\nkept benchmark site: ${cwd}`);
    else await rm(cwd, { recursive: true, force: true });
  }
}

async function measure(name: string, run: () => Promise<BuildSummary>): Promise<BenchResult> {
  const startedAt = performance.now();
  const summary = await run();
  return {
    name,
    durationMs: performance.now() - startedAt,
    summary,
    renderAverage: await formatRenderAverage(summary),
  };
}

async function makeBenchSite(count: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'laurel-performance-bench-'));
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });
  await mkdir(join(dir, 'content/tags'), { recursive: true });

  await writeFile(join(dir, 'laurel.toml'), configToml(), 'utf8');
  await writeFile(
    join(dir, 'content/authors/casper.md'),
    ['---', 'name: Casper', 'slug: casper', '---', ''].join('\n'),
    'utf8',
  );
  await writeFile(
    join(dir, 'content/tags/bench.md'),
    ['---', 'name: Bench', 'slug: bench', '---', ''].join('\n'),
    'utf8',
  );

  for (let i = 1; i <= count; i += 1) {
    await writeFile(join(dir, `content/posts/post-${pad(i)}.md`), postMarkdown(i), 'utf8');
  }

  await cp(join(process.cwd(), 'example/themes/source'), join(dir, 'themes/source'), {
    recursive: true,
  });

  return dir;
}

function configToml(): string {
  return [
    '[site]',
    'title = "Laurel Performance Bench"',
    'url = "https://bench.example.com"',
    'locale = "en"',
    'timezone = "UTC"',
    '',
    '[theme]',
    'dir = "themes"',
    'name = "source"',
    '',
    '[content]',
    'posts_dir = "content/posts"',
    'pages_dir = "content/pages"',
    'authors_dir = "content/authors"',
    'tags_dir = "content/tags"',
    'assets_dir = "content/images"',
    '',
    '[build]',
    'output_dir = "dist"',
    'posts_per_page = 20',
    'copy_content_assets = false',
    '',
    '[components.rss]',
    'enabled = false',
    '',
    '[components.sitemap]',
    'enabled = false',
    '',
    '[components.search]',
    'enabled = false',
    '',
    '[components.images]',
    'enabled = false',
    'resize = false',
    'formats = []',
    '',
  ].join('\n');
}

function postMarkdown(
  index: number,
  body = 'Benchmark body with enough text to exercise Markdown.',
): string {
  const day = (index % 28) + 1;
  return [
    '---',
    `title: "Benchmark Post ${pad(index)}"`,
    `slug: "post-${pad(index)}"`,
    `date: 2026-01-${String(day).padStart(2, '0')}T00:00:00Z`,
    'author: "casper"',
    'tags: ["bench"]',
    '---',
    '',
    body,
    '',
  ].join('\n');
}

function printResults(results: BenchResult[]): void {
  console.log(`Laurel performance benchmark (${postCount} posts)`);
  console.log('Target: full build 1k posts <3s, render <0.5ms/route average');
  console.log('');
  console.log(
    'case                         total       routes  rendered  skipped  render avg  peak RSS',
  );
  console.log(
    '---------------------------  ----------  ------  --------  -------  ----------  --------',
  );

  for (const result of results) {
    const summary = result.summary;
    console.log(
      [
        result.name.padEnd(27),
        formatMs(result.durationMs).padStart(10),
        String(summary.routeCount).padStart(6),
        String(summary.renderedCount).padStart(8),
        String(summary.skippedCount).padStart(7),
        result.renderAverage.padStart(10),
        formatMiB(summary.peakRssBytes).padStart(8),
      ].join('  '),
    );
  }
}

async function formatRenderAverage(summary: BuildSummary): Promise<string> {
  if (!summary.profilePath) return 'n/a';
  const stats = JSON.parse(await readFile(summary.profilePath, 'utf8')) as BuildStats;
  const renderedRoutes = stats.routes.filter((route) => !route.reused);
  if (renderedRoutes.length === 0) return 'n/a';
  const totalMs = renderedRoutes.reduce((sum, route) => sum + route.durationMs, 0);
  return `${(totalMs / renderedRoutes.length).toFixed(3)}ms`;
}

function formatMs(ms: number): string {
  return `${ms.toFixed(1)}ms`;
}

function formatMiB(bytes: number | undefined): string {
  if (bytes === undefined) return 'n/a';
  return `${(bytes / 1024 / 1024).toFixed(1)}MiB`;
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function pad(value: number): string {
  return String(value).padStart(4, '0');
}

await main();
