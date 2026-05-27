import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claudeSkillDir,
  installSkillForClaude,
  removeSkillForClaude,
} from '~/cli/skill/emitters/claude.ts';
import {
  codexSkillDir,
  installSkillForCodex,
  removeSkillForCodex,
} from '~/cli/skill/emitters/codex.ts';
import type { BundledSkill, SkillInstallReceipt } from '~/cli/skill/types.ts';

function fixtureSkill(overrides: Partial<BundledSkill> = {}): BundledSkill {
  return {
    slug: overrides.slug ?? 'test-skill',
    frontmatter: {
      name: 'nectar-test-skill',
      description: 'Use when testing the emitter pipeline.',
      version: 2,
      applies_to: ['claude', 'codex'],
      triggers: ['test trigger one', 'test trigger two'],
      ...overrides.frontmatter,
    },
    body: overrides.body ?? '# Test skill\n\nBody content.\n',
  };
}

describe('claude emitter', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'nectar-skill-claude-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('writes SKILL.md with Claude-compatible {name, description} frontmatter', async () => {
    const skill = fixtureSkill();
    const target = await installSkillForClaude(cwd, skill);
    expect(target).toBe(claudeSkillDir(cwd, 'test-skill'));
    const md = await readFile(join(target, 'SKILL.md'), 'utf8');
    expect(md).toMatch(/^---\nname: nectar-test-skill\ndescription: Use when testing/);
    expect(md).toContain('# Test skill');
    // Should not surface Nectar-internal frontmatter keys.
    expect(md).not.toContain('version:');
    expect(md).not.toContain('applies_to:');
  });

  test('writes a .nectar.json receipt for version tracking', async () => {
    const skill = fixtureSkill();
    const target = await installSkillForClaude(cwd, skill);
    const receipt = JSON.parse(
      await readFile(join(target, '.nectar.json'), 'utf8'),
    ) as SkillInstallReceipt;
    expect(receipt.slug).toBe('test-skill');
    expect(receipt.version).toBe(2);
    expect(receipt.format).toBe('claude');
    expect(typeof receipt.bundledAt).toBe('string');
  });

  test('quotes description when it contains YAML-sensitive characters', async () => {
    const skill = fixtureSkill({
      frontmatter: {
        name: 'nectar-test-skill',
        description: 'Has: a colon and "quotes" inside.',
        version: 1,
        applies_to: ['claude'],
      },
    });
    const target = await installSkillForClaude(cwd, skill);
    const md = await readFile(join(target, 'SKILL.md'), 'utf8');
    expect(md).toContain('description: "Has: a colon and \\"quotes\\" inside."');
  });

  test('removeSkillForClaude clears the skill directory', async () => {
    const skill = fixtureSkill();
    await installSkillForClaude(cwd, skill);
    expect(existsSync(claudeSkillDir(cwd, 'test-skill'))).toBe(true);
    const removed = await removeSkillForClaude(cwd, 'test-skill');
    expect(removed).toBe(true);
    expect(existsSync(claudeSkillDir(cwd, 'test-skill'))).toBe(false);
  });

  test('removeSkillForClaude is a no-op when the skill was not installed', async () => {
    const removed = await removeSkillForClaude(cwd, 'never-installed');
    expect(removed).toBe(false);
  });
});

describe('codex emitter', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'nectar-skill-codex-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('writes SKILL.md under .codex/skills/<slug>/ with a Triggers section', async () => {
    const skill = fixtureSkill();
    const target = await installSkillForCodex(cwd, skill);
    expect(target).toBe(codexSkillDir(cwd, 'test-skill'));
    const md = await readFile(join(target, 'SKILL.md'), 'utf8');
    expect(md).toContain('## Triggers');
    expect(md).toContain('- test trigger one');
    expect(md).toContain('- test trigger two');
    expect(md).toContain('# Test skill');
  });

  test('omits the Triggers section when source skill declares none', async () => {
    const skill: BundledSkill = {
      slug: 'no-triggers-skill',
      frontmatter: {
        name: 'nectar-no-triggers-skill',
        description: 'No triggers.',
        version: 1,
        applies_to: ['codex'],
      },
      body: '# Body without triggers\n',
    };
    const md = await readFile(join(await installSkillForCodex(cwd, skill), 'SKILL.md'), 'utf8');
    expect(md).not.toContain('## Triggers');
  });

  test('removeSkillForCodex returns true only when something was removed', async () => {
    const skill = fixtureSkill();
    await mkdir(codexSkillDir(cwd, 'test-skill'), { recursive: true });
    await installSkillForCodex(cwd, skill);
    expect(await removeSkillForCodex(cwd, 'test-skill')).toBe(true);
    expect(await removeSkillForCodex(cwd, 'test-skill')).toBe(false);
  });
});
