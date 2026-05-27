import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentFormat, BundledSkill, SkillInstallReceipt } from '../types.ts';

// OpenAI Codex (and the broader AGENTS.md ecosystem) does not define an
// official per-project skill directory yet. Nectar proposes the same shape
// it uses for Claude Code so contributors who maintain both formats see one
// consistent layout:
//   .codex/skills/<slug>/SKILL.md     ← same body as the Claude emit
//   .codex/skills/<slug>/.nectar.json ← install receipt
// Codex picks these up when AGENTS.md references them; the install command
// prints a one-line hint pointing the operator at that wiring step.

const FORMAT: AgentFormat = 'codex';

export function codexInstallDir(cwd: string): string {
  return join(cwd, '.codex', 'skills');
}

export function codexSkillDir(cwd: string, slug: string): string {
  return join(codexInstallDir(cwd), slug);
}

export async function installSkillForCodex(cwd: string, skill: BundledSkill): Promise<string> {
  const targetDir = codexSkillDir(cwd, skill.slug);
  await mkdir(targetDir, { recursive: true });
  const skillMd = renderCodexSkillMd(skill);
  await writeFile(join(targetDir, 'SKILL.md'), skillMd, 'utf8');
  const receipt: SkillInstallReceipt = {
    slug: skill.slug,
    version: skill.frontmatter.version,
    format: FORMAT,
    bundledAt: new Date().toISOString(),
  };
  await writeFile(join(targetDir, '.nectar.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return targetDir;
}

export async function removeSkillForCodex(cwd: string, slug: string): Promise<boolean> {
  const dir = codexSkillDir(cwd, slug);
  if (!existsSync(dir)) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}

function renderCodexSkillMd(skill: BundledSkill): string {
  // Same shape as Claude. The agent-neutral frontmatter (just name +
  // description) is the union all current LLM-loaders accept. Triggers stay
  // in the body to keep this format compatible with any AGENTS.md
  // aggregator the operator wires up.
  const fm = [
    '---',
    `name: ${skill.frontmatter.name}`,
    `description: ${escapeYamlScalar(skill.frontmatter.description)}`,
    '---',
  ].join('\n');
  const triggersBlock =
    skill.frontmatter.triggers && skill.frontmatter.triggers.length > 0
      ? `\n## Triggers\n\n${skill.frontmatter.triggers.map((t) => `- ${t}`).join('\n')}\n\n`
      : '\n';
  return `${fm}\n${triggersBlock}${skill.body}`;
}

function escapeYamlScalar(value: string): string {
  if (/[:#\n"'\\]/.test(value) || value.startsWith('-') || value.startsWith('?')) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}
