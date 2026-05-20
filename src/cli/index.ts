#!/usr/bin/env bun

import { EXIT_CODES } from '~/util/errors.ts';
import { logger, setColorEnabled, setLogLevel, setOutputMode } from '~/util/logger.ts';
import { getNectarVersion } from '~/util/nectar-version.ts';
import { warnIfBunEngineMismatch } from './bun-engine.ts';
import { type GlobalFlags, extractGlobalFlags } from './global-flags.ts';
import { suggestCommand } from './parse.ts';
import { reportError } from './report.ts';
import { COMMAND_NAMES, COMMAND_SPECS } from './specs.ts';

const COMMAND_ALIASES: Record<string, string> = { env: 'info' };

// Crash hooks: a stray `await` or floating promise that rejects in the build
// pipeline used to print a stack trace and leave the shell with a misleading
// exit code (sometimes 0 in older Node builds). We install explicit hooks at
// the CLI entrypoint so:
//   - The rejection / exception is reported through the same `reportError`
//     pipeline as a normal command failure (respects --json, NECTAR_DEBUG=1,
//     and the docs/hint annotations on NectarError).
//   - The process exits with status 1 deterministically.
// Listeners are installed at module load time so they cover dynamic imports
// in `dispatch()`, not just synchronous code paths in `main()`.
process.on('unhandledRejection', (reason: unknown) => {
  reportError(reason);
  process.exit(EXIT_CODES.generic);
});
process.on('uncaughtException', (err: unknown) => {
  reportError(err);
  process.exit(EXIT_CODES.generic);
});

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
  lines.push(`  ${'help'.padEnd(width)}Show this help or help for a command`);
  lines.push('');
  lines.push('Global options:');
  lines.push(`  ${'-q, --quiet'.padEnd(width)}Suppress info/debug output (keeps warn/error)`);
  lines.push(`  ${'-V, --verbose'.padEnd(width)}Increase verbosity to debug (stack -VV for trace)`);
  lines.push(
    `  ${'-j, --json'.padEnd(width)}Emit one JSON object per log line + JSON-shaped command output where supported`,
  );
  lines.push(
    `  ${'--no-color'.padEnd(width)}Disable ANSI color (also NO_COLOR=1 / NECTAR_NO_COLOR=1; FORCE_COLOR overrides)`,
  );
  lines.push(
    `  ${'--debug'.padEnd(width)}Show full stack traces on error (also NECTAR_DEBUG=1; default prints a short message)`,
  );
  lines.push('');
  lines.push('Run `nectar help <command>` or `nectar <command> --help` for more details.');
  lines.push('');
  stream.write(lines.join('\n'));
}

function resolveCommand(command: string, rest: string[]): { canonical: string; rest: string[] } {
  const dispatchRest = [...rest];
  let canonical = COMMAND_ALIASES[command] ?? command;
  if (command.startsWith('theme:')) {
    const sub = command.slice('theme:'.length);
    if (sub) {
      canonical = 'theme';
      dispatchRest.unshift(sub);
    }
  }
  return { canonical, rest: dispatchRest };
}

function printUnknownCommand(command: string, version: string): void {
  process.stderr.write(`Unknown command: ${command}\n`);
  const suggestion = suggestCommand(command, COMMAND_NAMES);
  if (suggestion) {
    process.stderr.write(`Did you mean \`nectar ${suggestion}\`?\n`);
  }
  process.stderr.write('\n');
  printTopUsage(version, process.stderr);
}

async function printCommandHelp(
  target: string | undefined,
  rest: string[],
  version: string,
): Promise<number> {
  if (target === undefined || target === 'help' || target === '--help' || target === '-h') {
    printTopUsage(version);
    return 0;
  }

  const resolved = resolveCommand(target, rest);
  if (!(resolved.canonical in COMMAND_SPECS)) {
    printUnknownCommand(target, version);
    return 2;
  }

  return dispatch(resolved.canonical, [...resolved.rest, '--help']);
}

async function dispatch(command: string, rest: string[]): Promise<number> {
  switch (command) {
    case 'init': {
      const { runInit } = await import('./commands/init.js');
      return runInit(rest);
    }
    case 'build': {
      const { runBuild } = await import('./commands/build.js');
      return runBuild(rest);
    }
    case 'new': {
      const { runNew } = await import('./commands/new.js');
      return runNew(rest);
    }
    case 'open': {
      const { runOpen } = await import('./commands/open.js');
      return runOpen(rest);
    }
    case 'check': {
      const { runCheck } = await import('./commands/check.js');
      return runCheck(rest);
    }
    case 'import-ghost': {
      const { runImportGhost } = await import('./commands/import-ghost.js');
      return runImportGhost(rest);
    }
    case 'import-wordpress': {
      const { runImportWordPress } = await import('./commands/import-wordpress.js');
      return runImportWordPress(rest);
    }
    case 'serve': {
      const { runServe } = await import('./commands/serve.js');
      return runServe(rest);
    }
    case 'dev': {
      const { runDev } = await import('./commands/dev.js');
      return runDev(rest);
    }
    case 'doctor': {
      const { runDoctor } = await import('./commands/doctor.js');
      return runDoctor(rest);
    }
    case 'clean': {
      const { runClean } = await import('./commands/clean.js');
      return runClean(rest);
    }
    case 'completions': {
      const { runCompletions } = await import('./commands/completions.js');
      return runCompletions(rest);
    }
    case 'content': {
      const { runContent } = await import('./commands/content.js');
      return runContent(rest);
    }
    case 'info': {
      const { runInfo } = await import('./commands/info.js');
      return runInfo(rest);
    }
    case 'tags': {
      const { runTags } = await import('./commands/tags.js');
      return runTags(rest);
    }
    case 'config': {
      const { runConfig } = await import('./commands/config.js');
      return runConfig(rest);
    }
    case 'schema': {
      const { runSchema } = await import('./commands/schema.js');
      return runSchema(rest);
    }
    case 'lint': {
      const { runLint } = await import('./commands/lint.js');
      return runLint(rest);
    }
    case 'migrate': {
      const { runMigrate } = await import('./commands/migrate.js');
      return runMigrate(rest);
    }
    case 'theme': {
      const { runTheme } = await import('./commands/theme.js');
      return runTheme(rest);
    }
    case 'deploy': {
      const { runDeploy } = await import('./commands/deploy.js');
      return runDeploy(rest);
    }
    case 'export': {
      const { runExport } = await import('./commands/export.js');
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
  if (flags.json) {
    setOutputMode('json');
    // JSON consumers can't read ANSI; flip color off so a json stream stays
    // 7-bit clean even when stderr is a TTY (e.g. piped through `jq`).
    setColorEnabled(false);
  }
  if (flags.noColor) {
    setColorEnabled(false);
  }
  if (flags.debug) {
    // `--debug` is shorthand for "show me the stack and bump log level".
    // Setting the env here also reaches modules that read NECTAR_DEBUG at
    // call time (e.g. report.ts).
    process.env.NECTAR_DEBUG = '1';
    if (!flags.quiet && flags.verboseCount === 0) {
      setLogLevel('debug');
    }
  }
}

async function main(argv: string[]): Promise<number> {
  const raw = argv.slice(2);
  const version = await getNectarVersion();

  let filtered: string[];
  let globalJson = false;
  try {
    const result = extractGlobalFlags(raw, process.env);
    applyGlobalFlags(result.flags);
    warnIfBunEngineMismatch(logger.warn);
    filtered = result.rest;
    globalJson = result.flags.json;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n`);
    printTopUsage(version, process.stderr);
    return 2;
  }

  const [command, ...restInitial] = filtered;
  const rest = [...restInitial];

  if (command === undefined || command === '--help' || command === '-h') {
    printTopUsage(version);
    return 0;
  }

  if (command === 'help') {
    return printCommandHelp(rest.shift(), rest, version);
  }

  if (command === 'version' || command === '--version' || command === '-v') {
    process.stdout.write(`${version}\n`);
    return 0;
  }

  // `env` is an alias for `info` so the second-nature `nectar env` lands on
  // the same renderer without duplicating the spec in COMMAND_SPECS (which
  // would re-render the help block twice in `docs/cli.md`).
  //
  // `theme:lint` is a convenience alias for `theme lint` matching the colon-
  // style most theme-author docs reach for. It rewrites the leading token
  // before dispatch so the rest of the argv is left untouched (path, flags).
  const { canonical, rest: resolvedRest } = resolveCommand(command, rest);

  if (!(canonical in COMMAND_SPECS)) {
    printUnknownCommand(command, version);
    return 2;
  }

  // Forward the global `--json` flag back into the subcommand argv so
  // commands that declare `json` in their spec (config, clean, doctor, lint,
  // build, check, ...) parse it through `parsed.values.json`. The global
  // extractor stripped it earlier to keep it out of the dispatcher's
  // command-name slot; we add it back here, but only if the user didn't
  // already type `--json` after the subcommand (rest already has it).
  const argsForDispatch =
    globalJson && !resolvedRest.includes('--json') ? ['--json', ...resolvedRest] : resolvedRest;

  return dispatch(canonical, argsForDispatch);
}

const code = await main(process.argv);
process.exit(code);
