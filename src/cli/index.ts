#!/usr/bin/env bun

import { setLogLevel } from '~/util/logger.ts';
import { getNectarVersion } from '~/util/nectar-version.ts';
import { type GlobalFlags, extractGlobalFlags } from './global-flags.ts';
import { suggestCommand } from './parse.ts';
import { COMMAND_NAMES, COMMAND_SPECS } from './specs.ts';

function printTopUsage(version: string, stream: NodeJS.WriteStream = process.stdout): void {
  const lines: string[] = [];
  lines.push(`nectar ${version}`);
  lines.push('');
  lines.push('Usage:');
  lines.push('  nectar [global options] <command> [options]');
  lines.push('');
  lines.push('Commands:');
  const width = Math.max(...COMMAND_NAMES.map((n) => n.length)) + 2;
  for (const name of COMMAND_NAMES) {
    const spec = COMMAND_SPECS[name];
    if (!spec) continue;
    lines.push(`  ${name.padEnd(width)}${spec.summary}`);
  }
  lines.push(`  ${'version'.padEnd(width)}Print the version`);
  lines.push(`  ${'help'.padEnd(width)}Show this help (or pass --help to any command)`);
  lines.push('');
  lines.push('Global options:');
  lines.push(`  ${'--quiet'.padEnd(width)}Suppress info/debug output (keeps warn/error)`);
  lines.push(`  ${'-V, --verbose'.padEnd(width)}Increase verbosity to debug (stack -VV for trace)`);
  lines.push('');
  lines.push('Run `nectar <command> --help` for more details on a specific command.');
  lines.push('');
  stream.write(lines.join('\n'));
}

async function dispatch(command: string, rest: string[]): Promise<number> {
  switch (command) {
    case 'init': {
      const { runInit } = await import('./commands/init.ts');
      return runInit(rest);
    }
    case 'build': {
      const { runBuild } = await import('./commands/build.ts');
      return runBuild(rest);
    }
    case 'new': {
      const { runNew } = await import('./commands/new.ts');
      return runNew(rest);
    }
    case 'open': {
      const { runOpen } = await import('./commands/open.ts');
      return runOpen(rest);
    }
    case 'check': {
      const { runCheck } = await import('./commands/check.ts');
      return runCheck(rest);
    }
    case 'import-ghost': {
      const { runImportGhost } = await import('./commands/import-ghost.ts');
      return runImportGhost(rest);
    }
    case 'import-wordpress': {
      const { runImportWordPress } = await import('./commands/import-wordpress.ts');
      return runImportWordPress(rest);
    }
    case 'serve': {
      const { runServe } = await import('./commands/serve.ts');
      return runServe(rest);
    }
    case 'dev': {
      const { runDev } = await import('./commands/dev.ts');
      return runDev(rest);
    }
    case 'doctor': {
      const { runDoctor } = await import('./commands/doctor.ts');
      return runDoctor(rest);
    }
    case 'clean': {
      const { runClean } = await import('./commands/clean.ts');
      return runClean(rest);
    }
    case 'completions': {
      const { runCompletions } = await import('./commands/completions.ts');
      return runCompletions(rest);
    }
    case 'content': {
      const { runContent } = await import('./commands/content.ts');
      return runContent(rest);
    }
    case 'info': {
      const { runInfo } = await import('./commands/info.ts');
      return runInfo(rest);
    }
    case 'tags': {
      const { runTags } = await import('./commands/tags.ts');
      return runTags(rest);
    }
    case 'config': {
      const { runConfig } = await import('./commands/config.ts');
      return runConfig(rest);
    }
    case 'lint': {
      const { runLint } = await import('./commands/lint.ts');
      return runLint(rest);
    }
    case 'migrate': {
      const { runMigrate } = await import('./commands/migrate.ts');
      return runMigrate(rest);
    }
    case 'theme': {
      const { runTheme } = await import('./commands/theme.ts');
      return runTheme(rest);
    }
    case 'deploy': {
      const { runDeploy } = await import('./commands/deploy.ts');
      return runDeploy(rest);
    }
    case 'export': {
      const { runExport } = await import('./commands/export.ts');
      return runExport(rest);
    }
    default:
      throw new Error(`Unhandled command: ${command}`);
  }
}

function applyGlobalFlags(flags: GlobalFlags): void {
  if (flags.quiet && flags.verboseCount > 0) {
    throw new Error('--quiet and --verbose cannot be used together');
  }
  if (flags.quiet) {
    setLogLevel('warn');
  } else if (flags.verboseCount === 1) {
    setLogLevel('debug');
  } else if (flags.verboseCount >= 2) {
    setLogLevel('trace');
  }
}

async function main(argv: string[]): Promise<number> {
  const raw = argv.slice(2);
  const version = await getNectarVersion();

  let filtered: string[];
  try {
    const result = extractGlobalFlags(raw, process.env);
    applyGlobalFlags(result.flags);
    filtered = result.rest;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n`);
    printTopUsage(version, process.stderr);
    return 2;
  }

  const [command, ...rest] = filtered;

  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    printTopUsage(version);
    return 0;
  }

  if (command === 'version' || command === '--version' || command === '-v') {
    process.stdout.write(`${version}\n`);
    return 0;
  }

  // `env` is an alias for `info` so the second-nature `nectar env` lands on
  // the same renderer without duplicating the spec in COMMAND_SPECS (which
  // would re-render the help block twice in `docs/cli.md`).
  const COMMAND_ALIASES: Record<string, string> = { env: 'info' };
  const canonical = COMMAND_ALIASES[command] ?? command;

  if (!(canonical in COMMAND_SPECS)) {
    process.stderr.write(`Unknown command: ${command}\n`);
    const suggestion = suggestCommand(command, COMMAND_NAMES);
    if (suggestion) {
      process.stderr.write(`Did you mean \`nectar ${suggestion}\`?\n`);
    }
    process.stderr.write('\n');
    printTopUsage(version, process.stderr);
    return 2;
  }

  return dispatch(canonical, rest);
}

const code = await main(process.argv);
process.exit(code);
