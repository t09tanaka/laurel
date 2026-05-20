import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { type ImportSummary, importGhostExport } from '~/ghost/import.ts';

// Realistic captured Ghost exports kept under tests/fixtures/ghost-exports/.
// Each fixture is paired with a golden-master snapshot of the markdown tree
// the importer produces, plus the summary counters. The snapshot is a plain
// text file so review diffs are trivial; rerun with UPDATE_SNAPSHOTS=1 to
// regenerate after an intentional importer change (#504).
const FIXTURES_DIR = join(import.meta.dir, '..', 'fixtures', 'ghost-exports');
const SNAPSHOTS_DIR = join(FIXTURES_DIR, 'snapshots');

const SUMMARY_KEYS = [
  'posts',
  'pages',
  'tags',
  'authors',
  'skipped',
  'overwritten',
  'renamed',
  'assetsCopied',
  'imagesDownloaded',
  'imagesFailed',
  'dryRun',
  'drafts',
  'statusFiltered',
  'bodiesEmpty',
  'redirectsImported',
  'slugRedirects',
  'codeInjectionSkipped',
  'slugCollisions',
] as const satisfies ReadonlyArray<keyof ImportSummary>;

function formatSummary(summary: ImportSummary): string {
  return SUMMARY_KEYS.map((k) => `${k}: ${summary[k]}`).join('\n');
}

async function snapshotMarkdownTree(cwd: string): Promise<string> {
  const root = join(cwd, 'content');
  const glob = new Bun.Glob('**/*.md');
  const rels: string[] = [];
  for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) {
    rels.push(rel);
  }
  rels.sort();
  const parts: string[] = [];
  for (const rel of rels) {
    const content = await readFile(join(root, rel), 'utf8');
    parts.push(`=== content/${rel.split(sep).join('/')} ===`);
    parts.push(content.trimEnd());
    parts.push('');
  }
  return parts.join('\n');
}

async function buildActualSnapshot(fixture: string, cwd: string): Promise<string> {
  const summary = await importGhostExport({
    cwd,
    file: join(FIXTURES_DIR, `${fixture}.json`),
    onConflict: 'overwrite',
  });
  const tree = await snapshotMarkdownTree(cwd);
  return `# summary\n${formatSummary(summary)}\n\n# tree\n${tree}`;
}

describe('importGhostExport — realistic export fixtures (#504)', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'nectar-import-fixtures-')));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  for (const fixture of ['small', 'medium', 'large', 'lexical-only', 'mobiledoc-only'] as const) {
    test(`${fixture}.json produces the captured markdown tree`, async () => {
      const actual = await buildActualSnapshot(fixture, cwd);
      const snapshotPath = join(SNAPSHOTS_DIR, `${fixture}.snapshot.txt`);

      if (process.env.UPDATE_SNAPSHOTS === '1') {
        await writeFile(snapshotPath, `${actual}\n`, 'utf8');
        return;
      }

      const expected = await readFile(snapshotPath, 'utf8');
      expect(actual).toBe(expected.replace(/\n$/, ''));
    });
  }

  // Regression guard for #441 / #75: lexical-only and mobiledoc-only exports
  // must produce non-empty post bodies. The snapshot tests above pin the exact
  // output, but a small explicit assertion makes the intent obvious if someone
  // ever regenerates the snapshots without inspecting them.
  for (const { fixture, slug, expectFragment } of [
    {
      fixture: 'lexical-only',
      slug: 'lexical-only',
      expectFragment: '**lexical-only**',
    },
    {
      fixture: 'mobiledoc-only',
      slug: 'mobiledoc-only',
      expectFragment: '**bold**',
    },
  ] as const) {
    test(`${fixture}.json renders a non-empty body and reports bodiesEmpty=0`, async () => {
      const originalWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (() => true) as typeof process.stderr.write;
      try {
        const summary = await importGhostExport({
          cwd,
          file: join(FIXTURES_DIR, `${fixture}.json`),
          onConflict: 'overwrite',
        });
        expect(summary.posts).toBe(1);
        expect(summary.bodiesEmpty).toBe(0);
        const body = await readFile(join(cwd, 'content', 'posts', `${slug}.md`), 'utf8');
        // Frontmatter must be followed by an actual body section.
        const afterFrontmatter = body.split(/^---$/m)[2] ?? '';
        expect(afterFrontmatter.trim()).not.toBe('');
        expect(body).toContain(expectFragment);
      } finally {
        process.stderr.write = originalWrite;
      }
    });
  }

  test('re-importing into the same cwd is idempotent under --on-conflict overwrite', async () => {
    const fixture = join(FIXTURES_DIR, 'small.json');
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      const first = await importGhostExport({ cwd, file: fixture, onConflict: 'overwrite' });
      const firstTree = await snapshotMarkdownTree(cwd);
      const second = await importGhostExport({ cwd, file: fixture, onConflict: 'overwrite' });
      const secondTree = await snapshotMarkdownTree(cwd);

      expect(second.posts).toBe(first.posts);
      expect(second.pages).toBe(first.pages);
      expect(second.tags).toBe(first.tags);
      expect(second.authors).toBe(first.authors);
      expect(secondTree).toBe(firstTree);
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});
