import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BUNDLED_SKILLS } from '~/cli/skill/bundled-skills.ts';
import { installSkillForClaude, removeSkillForClaude } from '~/cli/skill/emitters/claude.ts';
import { installSkillForCodex, removeSkillForCodex } from '~/cli/skill/emitters/codex.ts';
import type { AgentFormat, BundledSkill } from '~/cli/skill/types.ts';
import { EXIT_CODES } from '~/util/errors.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { SKILL_SPEC } from '../specs.ts';

export async function runSkill(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(SKILL_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(SKILL_SPEC));
      return EXIT_CODES.usage;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(SKILL_SPEC));
    return EXIT_CODES.ok;
  }

  const [sub, ...rest] = parsed.positionals;
  switch (sub) {
    case 'list':
      return runList(parsed.values.json === true);
    case 'install':
      return runInstall(process.cwd(), rest, parsed.values.format);
    case 'remove':
      return runRemove(process.cwd(), rest, parsed.values.format);
    default:
      process.stderr.write(
        `Unknown subcommand '${sub ?? '<missing>'}'. Use one of: list, install, remove.\n\n`,
      );
      process.stderr.write(formatCommandHelp(SKILL_SPEC));
      return EXIT_CODES.usage;
  }
}

function runList(asJson: boolean): number {
  if (asJson) {
    const items = BUNDLED_SKILLS.map((s) => ({
      slug: s.slug,
      name: s.frontmatter.name,
      version: s.frontmatter.version,
      applies_to: s.frontmatter.applies_to,
      description: s.frontmatter.description,
    }));
    process.stdout.write(`${JSON.stringify({ count: items.length, skills: items }, null, 2)}\n`);
    return EXIT_CODES.ok;
  }
  if (BUNDLED_SKILLS.length === 0) {
    process.stdout.write('No skills bundled with this Laurel build.\n');
    return EXIT_CODES.ok;
  }
  const slugWidth = BUNDLED_SKILLS.reduce((w, s) => Math.max(w, s.slug.length), 0);
  for (const skill of BUNDLED_SKILLS) {
    process.stdout.write(
      `${skill.slug.padEnd(slugWidth)}  v${skill.frontmatter.version}  ${skill.frontmatter.applies_to.join(', ')}\n`,
    );
    process.stdout.write(`${' '.repeat(slugWidth + 2)}${skill.frontmatter.description}\n`);
  }
  return EXIT_CODES.ok;
}

async function runInstall(cwd: string, slugs: string[], formatArg: unknown): Promise<number> {
  const formats = resolveFormats(cwd, formatArg);
  if (formats instanceof CliUsageError) {
    process.stderr.write(`${formats.message}\n`);
    return EXIT_CODES.usage;
  }
  const targets = pickSkills(slugs);
  if (targets instanceof CliUsageError) {
    process.stderr.write(`${targets.message}\n`);
    return EXIT_CODES.usage;
  }
  let installedCount = 0;
  for (const skill of targets) {
    for (const format of formats) {
      if (!skill.frontmatter.applies_to.includes(format)) continue;
      const path =
        format === 'claude'
          ? await installSkillForClaude(cwd, skill)
          : await installSkillForCodex(cwd, skill);
      logger.info(`Installed ${skill.slug} v${skill.frontmatter.version} -> ${path}`);
      installedCount += 1;
    }
  }
  if (installedCount === 0) {
    process.stderr.write('No matching skills to install (check --format and skill names).\n');
    return EXIT_CODES.usage;
  }
  if (formats.includes('codex')) {
    logger.info('Tip: Codex auto-discovers these skills under .agents/skills/*/SKILL.md.');
  }
  return EXIT_CODES.ok;
}

async function runRemove(cwd: string, slugs: string[], formatArg: unknown): Promise<number> {
  if (slugs.length === 0) {
    process.stderr.write('Usage: laurel skill remove <slug> [--format claude|codex|all]\n');
    return EXIT_CODES.usage;
  }
  const formats = resolveFormats(cwd, formatArg);
  if (formats instanceof CliUsageError) {
    process.stderr.write(`${formats.message}\n`);
    return EXIT_CODES.usage;
  }
  let removedCount = 0;
  for (const slug of slugs) {
    for (const format of formats) {
      const removed =
        format === 'claude'
          ? await removeSkillForClaude(cwd, slug)
          : await removeSkillForCodex(cwd, slug);
      if (removed) {
        logger.info(`Removed ${slug} (${format})`);
        removedCount += 1;
      }
    }
  }
  if (removedCount === 0) {
    process.stderr.write('No matching skills were installed.\n');
    return EXIT_CODES.usage;
  }
  return EXIT_CODES.ok;
}

// Decide which agent format(s) to operate on. Source of signal, in order:
//   1. Explicit --format flag (claude | codex | all | comma-separated list)
//   2. Auto-detect via CLAUDE.md / AGENTS.md presence in cwd
//   3. Neither present + no flag → usage error (operator must declare intent)
function resolveFormats(cwd: string, formatArg: unknown): AgentFormat[] | CliUsageError {
  if (typeof formatArg === 'string' && formatArg.trim().length > 0) {
    const tokens = formatArg
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
    if (tokens.includes('all')) return ['claude', 'codex'];
    const formats: AgentFormat[] = [];
    for (const token of tokens) {
      if (token === 'claude' || token === 'codex') {
        if (!formats.includes(token)) formats.push(token);
      } else {
        return new CliUsageError(
          `Invalid --format value: ${token}. Use one or more of: claude, codex, all.`,
        );
      }
    }
    if (formats.length === 0) {
      return new CliUsageError('Empty --format value. Use claude, codex, all, or a comma list.');
    }
    return formats;
  }
  const hasClaudeMd = existsSync(join(cwd, 'CLAUDE.md'));
  const hasAgentsMd = existsSync(join(cwd, 'AGENTS.md'));
  if (hasClaudeMd && hasAgentsMd) return ['claude', 'codex'];
  if (hasClaudeMd) return ['claude'];
  if (hasAgentsMd) return ['codex'];
  return new CliUsageError(
    'Could not detect which agent this project targets. Create CLAUDE.md (for Claude Code) or AGENTS.md (for Codex / agent-neutral) at the project root, or pass --format claude|codex|all explicitly.',
  );
}

function pickSkills(slugs: string[]): BundledSkill[] | CliUsageError {
  if (slugs.length === 0) return [...BUNDLED_SKILLS];
  const picked: BundledSkill[] = [];
  for (const slug of slugs) {
    const match = BUNDLED_SKILLS.find((s) => s.slug === slug);
    if (!match) {
      const known = BUNDLED_SKILLS.map((s) => s.slug).join(', ');
      return new CliUsageError(`Unknown skill '${slug}'. Known: ${known}.`);
    }
    if (!picked.includes(match)) picked.push(match);
  }
  return picked;
}
