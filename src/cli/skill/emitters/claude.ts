import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentFormat, BundledSkill, SkillInstallReceipt } from '../types.ts';

// Claude Code per-project skill format:
//   .claude/skills/<slug>/SKILL.md   ← markdown with {name, description} frontmatter
//   .claude/skills/<slug>/.laurel.json ← install receipt so update checks can
//                                        compare bundled vs installed version
//                                        without parsing the agent's own
//                                        frontmatter shape
// The directory shape mirrors how Anthropic's CLI loads skills from the
// project working tree.

const FORMAT: AgentFormat = 'claude';

export function claudeInstallDir(cwd: string): string {
  return join(cwd, '.claude', 'skills');
}

export function claudeSkillDir(cwd: string, slug: string): string {
  return join(claudeInstallDir(cwd), slug);
}

export async function installSkillForClaude(cwd: string, skill: BundledSkill): Promise<string> {
  const targetDir = claudeSkillDir(cwd, skill.slug);
  await mkdir(targetDir, { recursive: true });
  const skillMd = renderClaudeSkillMd(skill);
  await writeFile(join(targetDir, 'SKILL.md'), skillMd, 'utf8');
  const receipt: SkillInstallReceipt = {
    slug: skill.slug,
    version: skill.frontmatter.version,
    format: FORMAT,
    bundledAt: new Date().toISOString(),
  };
  await writeFile(join(targetDir, '.laurel.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return targetDir;
}

export async function removeSkillForClaude(cwd: string, slug: string): Promise<boolean> {
  const dir = claudeSkillDir(cwd, slug);
  if (!existsSync(dir)) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}

// Render the SKILL.md body that Anthropic's loader expects: a frontmatter
// block containing `name` and `description`, followed by the skill body
// verbatim. We strip Laurel-internal fields (version, applies_to, triggers)
// from the emitted frontmatter — they're useful in source-of-truth but
// Anthropic's matcher only looks at `description`.
function renderClaudeSkillMd(skill: BundledSkill): string {
  const fm = [
    '---',
    `name: ${skill.frontmatter.name}`,
    `description: ${escapeYamlScalar(skill.frontmatter.description)}`,
    '---',
  ].join('\n');
  return `${fm}\n\n${skill.body}`;
}

function escapeYamlScalar(value: string): string {
  // Quote when the value contains characters that would change YAML parsing
  // (colons followed by space, leading dashes, embedded quotes, etc.). Plain
  // double-quote escaping covers the cases skill descriptions can actually
  // hit; we don't try to handle multi-line block scalars.
  if (/[:#\n"'\\]/.test(value) || value.startsWith('-') || value.startsWith('?')) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}
