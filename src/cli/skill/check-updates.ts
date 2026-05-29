import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BUNDLED_SKILLS } from './bundled-skills.ts';
import { claudeSkillDir } from './emitters/claude.ts';
import { codexSkillDir } from './emitters/codex.ts';
import type { AgentFormat, BundledSkill, SkillInstallReceipt } from './types.ts';

// `nectar dev` / `nectar dashboard` startup banners call this to surface a
// one-line "N skill updates available" notice when the bundled CLI ships a
// newer version than what is installed locally. The walk is fs-only (no
// network) and tolerates a missing/corrupt receipt by treating the skill as
// "needs reinstall" -- the worst case is a noisy notice, never a crash.

interface SkillUpdateStatus {
  slug: string;
  format: AgentFormat;
  installedVersion: number | null;
  bundledVersion: number;
  path: string;
}

export async function findOutdatedSkills(cwd: string): Promise<SkillUpdateStatus[]> {
  const results: SkillUpdateStatus[] = [];
  for (const skill of BUNDLED_SKILLS) {
    if (skill.frontmatter.applies_to.includes('claude')) {
      const status = await statSkill(cwd, skill, 'claude');
      if (status !== null && shouldReport(status)) results.push(status);
    }
    if (skill.frontmatter.applies_to.includes('codex')) {
      const status = await statSkill(cwd, skill, 'codex');
      if (status !== null && shouldReport(status)) results.push(status);
    }
  }
  return results;
}

async function statSkill(
  cwd: string,
  skill: BundledSkill,
  format: AgentFormat,
): Promise<SkillUpdateStatus | null> {
  const dir =
    format === 'claude' ? claudeSkillDir(cwd, skill.slug) : codexSkillDir(cwd, skill.slug);
  if (!existsSync(dir)) {
    // Skill never installed for this format -- not an "update available",
    // just absent. Skip so we don't flood new projects with notices.
    return null;
  }
  const receiptPath = join(dir, '.nectar.json');
  if (!existsSync(receiptPath)) {
    return {
      slug: skill.slug,
      format,
      installedVersion: null,
      bundledVersion: skill.frontmatter.version,
      path: dir,
    };
  }
  try {
    const raw = await readFile(receiptPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SkillInstallReceipt>;
    const installedVersion =
      typeof parsed.version === 'number' && Number.isFinite(parsed.version) ? parsed.version : null;
    return {
      slug: skill.slug,
      format,
      installedVersion,
      bundledVersion: skill.frontmatter.version,
      path: dir,
    };
  } catch {
    // Treat unreadable / malformed receipts as "needs reinstall" so the
    // notice still nudges the operator toward `nectar skill install`.
    return {
      slug: skill.slug,
      format,
      installedVersion: null,
      bundledVersion: skill.frontmatter.version,
      path: dir,
    };
  }
}

function shouldReport(status: SkillUpdateStatus): boolean {
  if (status.installedVersion === null) return true;
  return status.installedVersion < status.bundledVersion;
}
