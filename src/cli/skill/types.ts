// Source-of-truth shape for a Laurel-bundled agent skill. Each skill lives at
// src/skills/<slug>/skill.md and is materialised into ~~src/cli/skill/bundled-skills.ts~~
// by scripts/build-skill-bundle.ts so the compiled CLI binary can ship the
// skill content without depending on the source tree.
//
// `applies_to` enumerates the agent format emitters that should pick up this
// skill on `laurel skill install`. Unknown values are ignored (emitters only
// emit for their own format), so adding `cursor` here later is safe even on
// older CLI versions.

export type AgentFormat = 'claude' | 'codex';

export interface SkillFrontmatter {
  name: string;
  description: string;
  version: number;
  applies_to: AgentFormat[];
  triggers?: string[];
}

export interface BundledSkill {
  // Directory slug under src/skills/. Used as the install target name too
  // (e.g. .claude/skills/<slug>/SKILL.md). Independent from frontmatter.name
  // because Claude Code's name field has its own constraints; the slug stays
  // stable across renames.
  slug: string;
  frontmatter: SkillFrontmatter;
  body: string;
}

// Per-install bookkeeping written next to the emitted skill so update checks
// can compare bundled vs installed version without re-parsing the agent's own
// format. Lives at `<install-dir>/.laurel.json` per skill.
export interface SkillInstallReceipt {
  slug: string;
  version: number;
  format: AgentFormat;
  bundledAt: string;
}
