import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUNDLED_SKILLS } from '~/cli/skill/bundled-skills.ts';
import { findOutdatedSkills } from '~/cli/skill/check-updates.ts';

// Stages an installed skill at .claude/skills/<slug>/ with a receipt at the
// requested version, so we can simulate "older than bundled" / "matches
// bundled" / "missing receipt" without invoking the real emitter.
async function stageInstalledSkill(
  cwd: string,
  format: 'claude' | 'codex',
  slug: string,
  receipt: { version: number; bundledAt?: string } | 'missing-receipt',
): Promise<void> {
  const dir = join(
    cwd,
    ...(format === 'claude' ? ['.claude', 'skills'] : ['.agents', 'skills']),
    slug,
  );
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), '# placeholder\n');
  if (receipt === 'missing-receipt') return;
  await writeFile(
    join(dir, '.nectar.json'),
    JSON.stringify(
      {
        slug,
        version: receipt.version,
        format,
        bundledAt: receipt.bundledAt ?? '2026-05-27T00:00:00Z',
      },
      null,
      2,
    ),
  );
}

describe('findOutdatedSkills', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'nectar-skill-updates-'));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('empty result when no skills are installed', async () => {
    expect(await findOutdatedSkills(cwd)).toEqual([]);
  });

  test('reports a skill installed at a version below bundled', async () => {
    const bundled = BUNDLED_SKILLS[0];
    if (!bundled) throw new Error('expected at least one bundled skill');
    await stageInstalledSkill(cwd, 'claude', bundled.slug, {
      version: bundled.frontmatter.version - 1,
    });
    const outdated = await findOutdatedSkills(cwd);
    expect(outdated.some((s) => s.slug === bundled.slug && s.format === 'claude')).toBe(true);
  });

  test('does not report when installed version matches bundled', async () => {
    const bundled = BUNDLED_SKILLS[0];
    if (!bundled) throw new Error('expected at least one bundled skill');
    await stageInstalledSkill(cwd, 'claude', bundled.slug, {
      version: bundled.frontmatter.version,
    });
    const outdated = await findOutdatedSkills(cwd);
    expect(outdated.find((s) => s.slug === bundled.slug && s.format === 'claude')).toBeUndefined();
  });

  test('reports skills with missing receipts as needing reinstall', async () => {
    const bundled = BUNDLED_SKILLS[0];
    if (!bundled) throw new Error('expected at least one bundled skill');
    await stageInstalledSkill(cwd, 'codex', bundled.slug, 'missing-receipt');
    const outdated = await findOutdatedSkills(cwd);
    const match = outdated.find((s) => s.slug === bundled.slug && s.format === 'codex');
    expect(match?.installedVersion).toBeNull();
  });
});
