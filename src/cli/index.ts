#!/usr/bin/env bun

import { suggestCommand } from './parse.ts';
import { COMMAND_NAMES, COMMAND_SPECS } from './specs.ts';

const VERSION = '0.0.1';

function printTopUsage(stream: NodeJS.WriteStream = process.stdout): void {
  const lines: string[] = [];
  lines.push(`nectar ${VERSION}`);
  lines.push('');
  lines.push('Usage:');
  lines.push('  nectar <command> [options]');
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
  lines.push('Run `nectar <command> --help` for more details on a specific command.');
  lines.push('');
  stream.write(lines.join('\n'));
}

async function dispatch(command: string, rest: string[]): Promise<number> {
  switch (command) {
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

async function main(argv: string[]): Promise<number> {
  const [, , command, ...rest] = argv;

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
