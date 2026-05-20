// 10k-post end-to-end build benchmark. Generates a synthetic content tree off
// the vendored Source theme and runs `build` against it twice (cold + warm) so
// regressions in route planning, markdown rendering, or asset/incremental
// emission show up as wall-time / memory deltas in CI-adjacent runs without
// being wired into `bun test` itself.
//
// Targets (see backlog #153):
//   - cold build:        <15s wall time
//   - incremental build: <1s wall time (no content changes)
//   - peak memory (rss): <300MB
//
// Output is human-readable on stdout; machine-friendly JSON is emitted to
// stderr only when `--json` is passed so downstream pipelines can capture
// trend data without parsing the table.
//
// Usage:
//   bun run benchmarks/bench-10k.ts            # cold + incremental, 10k posts
//   POSTS=2000 bun run benchmarks/bench-10k.ts # smaller corpus
//   bun run benchmarks/bench-10k.ts --json     # JSON line on stderr
//   bun run benchmarks/bench-10k.ts --keep     # don't rm the tmp dir at the end

import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from '~/build/pipeline.ts';

const POST_COUNT = Number(process.env.POSTS ?? '10000');
const TAG_COUNT = Number(process.env.TAGS ?? '50');
const AUTHOR_COUNT = Number(process.env.AUTHORS ?? '10');
const KEEP_TMP = process.argv.includes('--keep');
const EMIT_JSON = process.argv.includes('--json');

// Lorem-ish body large enough to exercise markdown rendering but small enough
// that 10k copies don't OOM the runner. Each post lands at ~600 bytes of body
// markdown + frontmatter, so the corpus is ~6MB on disk.
const BODY = [
  '# Heading One',
  '',
  'This is a paragraph of body text used by the synthetic benchmark corpus. ',
  'It exists to exercise the markdown renderer with multiple paragraphs, ',
  'lists, and inline formatting without requiring real human content.',
  '',
  '## Heading Two',
  '',
  '- list item one',
  '- list item two with **bold**, *italics*, and `inline code`',
  '- [a link](https://example.com)',
  '',
  '> A blockquote that mentions Ghost, Nectar, and Markdown.',
  '',
  '```ts',
  'export function greet(name: string): string {',
  '  return `Hello, ${name}!`;',
  '}',
  '```',
  '',
  'Another paragraph rounds the post out to a realistic word count for a',
  'short blog entry. Read more at https://nectar.example.com/.',
].join('\n');

interface BenchResult {
  label: string;
  wallMs: number;
  rssBytes: number;
  routeCount: number;
  renderedCount: number;
  skippedCount: number;
}

async function setupCorpus(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'nectar-bench-10k-'));
  const themeSrc = resolve(import.meta.dir, '..', 'example', 'themes', 'source');
  cpSync(themeSrc, join(cwd, 'themes', 'source'), { recursive: true });

  // Minimal nectar.toml. Static-only deploy targets, sitemap on, RSS on.
  writeFileSync(
    join(cwd, 'nectar.toml'),
    [
      '[site]',
      'title = "Nectar 10k Bench"',
      'description = "Synthetic corpus for benchmarks/bench-10k.ts"',
      'url = "https://bench.example.com"',
      'locale = "en"',
      'timezone = "UTC"',
      '',
      '[theme]',
      'name = "source"',
      'dir = "themes"',
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
      'posts_per_page = 25',
      '',
      '[components.search]',
      'enabled = false',
      '',
      '[components.images]',
      'enabled = false',
      'resize = false',
      '',
    ].join('\n'),
    'utf8',
  );

  const postsDir = join(cwd, 'content', 'posts');
  const pagesDir = join(cwd, 'content', 'pages');
  const authorsDir = join(cwd, 'content', 'authors');
  const tagsDir = join(cwd, 'content', 'tags');
  mkdirSync(postsDir, { recursive: true });
  mkdirSync(pagesDir, { recursive: true });
  mkdirSync(authorsDir, { recursive: true });
  mkdirSync(tagsDir, { recursive: true });

  for (let i = 0; i < AUTHOR_COUNT; i += 1) {
    writeFileSync(
      join(authorsDir, `author-${i}.md`),
      `---\nname: "Author ${i}"\nbio: "Synthetic benchmark author ${i}"\n---\n`,
      'utf8',
    );
  }
  for (let i = 0; i < TAG_COUNT; i += 1) {
    writeFileSync(
      join(tagsDir, `tag-${i}.md`),
      `---\nname: "Tag ${i}"\ndescription: "Synthetic benchmark tag ${i}"\n---\n`,
      'utf8',
    );
  }

  // One static page so the page-template branch exercises at least once.
  writeFileSync(join(pagesDir, 'about.md'), '---\ntitle: "About"\n---\n\nAbout body.\n', 'utf8');

  // Posts are spread across tags + authors with a deterministic round-robin so
  // every tag/author has roughly POSTS/TAGS posts. Dates are sequential so the
  // sort step has work to do.
  const startMs = Date.UTC(2020, 0, 1);
  for (let i = 0; i < POST_COUNT; i += 1) {
    const tag = `tag-${i % TAG_COUNT}`;
    const author = `author-${i % AUTHOR_COUNT}`;
    const date = new Date(startMs + i * 60_000).toISOString();
    const frontmatter = [
      '---',
      `title: "Synthetic Post ${i}"`,
      `date: ${date}`,
      `tags: [${tag}]`,
      `authors: [${author}]`,
      '---',
      '',
    ].join('\n');
    writeFileSync(join(postsDir, `post-${i}.md`), `${frontmatter}${BODY}\n`, 'utf8');
  }

  return cwd;
}

async function runBuild(cwd: string, label: string): Promise<BenchResult> {
  // Force GC if the runner is started with `--expose-gc`; harmless otherwise.
  if (typeof (globalThis as { gc?: () => void }).gc === 'function') {
    (globalThis as { gc: () => void }).gc();
  }
  const startMem = process.memoryUsage().rss;
  const startNs = process.hrtime.bigint();
  const summary = await build({ cwd });
  const endNs = process.hrtime.bigint();
  const endMem = process.memoryUsage().rss;
  return {
    label,
    wallMs: Number(endNs - startNs) / 1_000_000,
    rssBytes: Math.max(endMem, startMem),
    routeCount: summary.routeCount,
    renderedCount: summary.renderedCount,
    skippedCount: summary.skippedCount,
  };
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function printRow(r: BenchResult): void {
  console.log(
    `  ${r.label.padEnd(14)} ${fmtMs(r.wallMs).padStart(10)}  ${fmtBytes(r.rssBytes).padStart(10)}  ` +
      `routes=${r.routeCount}  rendered=${r.renderedCount}  skipped=${r.skippedCount}`,
  );
}

async function main(): Promise<void> {
  console.log(`nectar bench-10k: posts=${POST_COUNT} tags=${TAG_COUNT} authors=${AUTHOR_COUNT}`);
  console.log('  targets: cold <15s, incremental <1s, rss <300MB');

  const cwd = await setupCorpus();
  console.log(`  corpus at: ${cwd}`);

  try {
    const cold = await runBuild(cwd, 'cold');
    printRow(cold);
    const incremental = await runBuild(cwd, 'incremental');
    printRow(incremental);

    if (EMIT_JSON) {
      const payload = {
        posts: POST_COUNT,
        tags: TAG_COUNT,
        authors: AUTHOR_COUNT,
        cold,
        incremental,
      };
      process.stderr.write(`${JSON.stringify(payload)}\n`);
    }

    // Soft warnings, not failures: this script is meant for ad-hoc runs and
    // tracking trends, not as a regression gate that fails CI on noisy
    // numbers. Operators read the warnings and dig in if a knob slipped.
    if (cold.wallMs > 15_000) {
      console.warn(`  WARN: cold build above 15s target (${fmtMs(cold.wallMs)})`);
    }
    if (incremental.wallMs > 1_000) {
      console.warn(`  WARN: incremental build above 1s target (${fmtMs(incremental.wallMs)})`);
    }
    if (cold.rssBytes > 300 * 1024 * 1024) {
      console.warn(`  WARN: peak RSS above 300MB target (${fmtBytes(cold.rssBytes)})`);
    }
  } finally {
    if (!KEEP_TMP) {
      await rm(cwd, { recursive: true, force: true });
    } else {
      console.log(`  kept tmp dir: ${cwd}`);
    }
  }
}

await main();
