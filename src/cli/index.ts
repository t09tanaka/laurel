#!/usr/bin/env bun

const VERSION = '0.0.1';

function printUsage(): void {
  const out = [
    `nectar ${VERSION}`,
    '',
    'Usage:',
    '  nectar build [--config <path>]   Build the site into the configured output directory',
    '  nectar new <kind> <title>        Scaffold a new post or page',
    '  nectar serve [--port <n>]        Serve the built site locally',
    '  nectar import-ghost <file>       Convert a Ghost JSON export into Markdown content',
    '  nectar check                     Validate config, theme, and content',
    '  nectar version                   Print the version',
    '',
  ].join('\n');
  process.stdout.write(`${out}\n`);
}

async function main(argv: string[]): Promise<number> {
  const [, , command, ...rest] = argv;
  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printUsage();
      return 0;
    case 'version':
    case '--version':
    case '-v':
      process.stdout.write(`${VERSION}\n`);
      return 0;
    case 'build': {
      const { runBuild } = await import('./commands/build.ts');
      return await runBuild(rest);
    }
    case 'new': {
      const { runNew } = await import('./commands/new.ts');
      return await runNew(rest);
    }
    case 'check': {
      const { runCheck } = await import('./commands/check.ts');
      return await runCheck(rest);
    }
    case 'import-ghost': {
      const { runImportGhost } = await import('./commands/import-ghost.ts');
      return await runImportGhost(rest);
    }
    case 'serve': {
      const { runServe } = await import('./commands/serve.ts');
      return await runServe(rest);
    }
    default:
      process.stderr.write(`Unknown command: ${command}\n\n`);
      printUsage();
      return 2;
  }
}

const code = await main(process.argv);
process.exit(code);
