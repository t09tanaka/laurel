import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { type ImportSummary, importGhostExport } from '~/ghost/import.ts';

const FIXTURE_PATH = join(import.meta.dir, '..', 'fixtures', 'ghost-export.json');
const SNAPSHOT_PATH = join(import.meta.dir, '..', 'fixtures', 'ghost-export.snapshot.txt');

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

async function buildActualSnapshot(cwd: string): Promise<string> {
  const summary = await importGhostExport({
    cwd,
    file: FIXTURE_PATH,
    onConflict: 'overwrite',
  });
  const tree = await snapshotMarkdownTree(cwd);
  return `# summary\n${formatSummary(summary)}\n\n# tree\n${tree}`;
}

describe('importGhostExport - Ghost demo card fixture (#391)', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-cards-')));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('imports one post per Ghost card type and matches the markdown snapshot', async () => {
    const actual = await buildActualSnapshot(cwd);

    if (process.env.UPDATE_SNAPSHOTS === '1') {
      await writeFile(SNAPSHOT_PATH, `${actual}\n`, 'utf8');
      return;
    }

    const expected = await readFile(SNAPSHOT_PATH, 'utf8');
    expect(actual).toBe(expected.replace(/\n$/, ''));
  });
});
