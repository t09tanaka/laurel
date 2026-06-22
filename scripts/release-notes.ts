#!/usr/bin/env bun

/**
 * Build standardized GitHub Release notes for a Laurel version.
 *
 * The body combines two sources:
 *   1. The hand-curated CHANGELOG.md section for the version (what changed and
 *      why). CHANGELOG.md is the single source of truth.
 *   2. GitHub's auto-generated PR / "New Contributors" list plus the
 *      full-changelog compare link, fetched via the gh CLI.
 *
 * Usage:
 *   bun run release:notes <version>            # prints the notes to stdout
 *   bun run release:notes <version> --no-gh    # CHANGELOG section + compare link only
 *
 * The version may be given with or without a leading `v`. The notes are written
 * to stdout so the release flow can pipe them into `gh release create`:
 *
 *   bun run release:notes 0.1.12 > /tmp/notes.md
 *   gh release create v0.1.12 --title v0.1.12 --notes-file /tmp/notes.md --verify-tag
 *
 * Requires the tag to already exist on GitHub (push it before generating notes),
 * because gh's generate-notes API resolves PRs from the pushed ref.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { extractChangelogSection } from '~/util/changelog.ts';

const REPO = 't09tanaka/laurel';
const CHANGELOG_PATH = resolve(import.meta.dir, '..', 'CHANGELOG.md');

function usage(): string {
  return [
    'Usage: bun run release:notes <version> [--no-gh]',
    '',
    'Prints GitHub Release notes for <version> to stdout, combining the',
    'CHANGELOG.md section with gh-generated PR/contributor notes.',
  ].join('\n');
}

function compareLink(previous: string | null, version: string): string {
  const tag = `v${version}`;
  if (!previous) {
    return `**Full changelog**: https://github.com/${REPO}/commits/${tag}`;
  }
  return `**Full changelog**: https://github.com/${REPO}/compare/v${previous}...${tag}`;
}

/**
 * Ask GitHub to generate the PR / contributor section for the tag. Returns null
 * (with a warning) if gh is unavailable or the tag is not yet on the remote, so
 * notes generation degrades to the CHANGELOG section rather than failing the
 * whole release.
 */
async function generatedNotes(version: string, previous: string | null): Promise<string | null> {
  const args = [
    'api',
    '--method',
    'POST',
    `repos/${REPO}/releases/generate-notes`,
    '-f',
    `tag_name=v${version}`,
    '-q',
    '.body',
  ];
  if (previous) {
    args.push('-f', `previous_tag_name=v${previous}`);
  }

  const proc = Bun.spawn(['gh', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    const detail = stderr.trim() || `gh exited with code ${exitCode}`;
    console.warn(
      `warning: could not fetch gh-generated notes (${detail}). ` +
        'Falling back to the CHANGELOG section and compare link only.',
    );
    return null;
  }
  return stdout.trim() || null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    console.log(usage());
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const noGh = argv.includes('--no-gh');
  const versionArg = argv.find((arg) => !arg.startsWith('-'));
  if (!versionArg) {
    console.error(usage());
    process.exit(1);
  }

  const changelog = await readFile(CHANGELOG_PATH, 'utf8');
  const section = extractChangelogSection(changelog, versionArg);
  const version = section.version;

  const parts = [section.body];

  if (!noGh) {
    const generated = await generatedNotes(version, section.previousVersion);
    if (generated) {
      parts.push(generated);
      // gh's generated body already ends with its own full-changelog link, so we
      // do not append our own to avoid duplication.
      console.log(parts.join('\n\n'));
      return;
    }
  }

  parts.push(compareLink(section.previousVersion, version));
  console.log(parts.join('\n\n'));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
