#!/usr/bin/env bun

import { setLogLevel } from '~/util/logger.ts';
import { type GlobalFlags, extractGlobalFlags } from './global-flags.ts';
import { suggestCommand } from './parse.ts';
import { COMMAND_NAMES, COMMAND_SPECS } from './specs.ts';

const VERSION = '0.0.1';

function printTopUsage(stream: NodeJS.WriteStream = process.stdout): void {
  const lines: string[] = [];
  lines.push(`nectar ${VERSION}`);
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
    case 'check': {
      const { runCheck } = await import('./commands/check.ts');
      return runCheck(rest);
    }
    case 'import-ghost': {
      const { runImportGhost } = await import('./commands/import-ghost.ts');
      return runImportGhost(rest);
    }
    case 'serve': {
      const { runServe } = await import('./commands/serve.ts');
      return runServe(rest);
    }
    case 'doctor': {
      const { runDoctor } = await import('./commands/doctor.ts');
      return runDoctor(rest);
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

  let filtered: string[];
  try {
    const result = extractGlobalFlags(raw);
    applyGlobalFlags(result.flags);
    filtered = result.rest;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n`);
    printTopUsage(process.stderr);
    return 2;
  }

  const [command, ...rest] = filtered;

  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    printTopUsage();
    return 0;
  }

  if (command === 'version' || command === '--version' || command === '-v') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  if (!(command in COMMAND_SPECS)) {
    process.stderr.write(`Unknown command: ${command}\n`);
    const suggestion = suggestCommand(command, COMMAND_NAMES);
    if (suggestion) {
      process.stderr.write(`Did you mean \`nectar ${suggestion}\`?\n`);
    }
    process.stderr.write('\n');
    printTopUsage(process.stderr);
    return 2;
  }

  return dispatch(command, rest);
}

const code = await main(process.argv);
process.exit(code);
