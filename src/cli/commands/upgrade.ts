import { existsSync, realpathSync } from 'node:fs';
import { normalize } from 'node:path';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { UPGRADE_SPEC } from '../specs.ts';

type InstallMethod = 'bun-global' | 'npm-global' | 'bunx' | 'homebrew' | 'unknown';

interface UpgradePlan {
  method: InstallMethod;
  command: string[];
  selfUpdatable: boolean;
  reason: string;
}

interface UpgradeRuntime {
  argv?: string[];
  env?: Record<string, string | undefined>;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
  spawn?: typeof Bun.spawn;
  realpath?: (path: string) => string;
  exists?: (path: string) => boolean;
}

const PACKAGE_NAME = 'laurel';

export async function runUpgrade(args: string[], runtime: UpgradeRuntime = {}): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(UPGRADE_SPEC, args, runtime.env ?? process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      (runtime.stderr ?? process.stderr).write(`${err.message}\n\n`);
      (runtime.stderr ?? process.stderr).write(formatCommandHelp(UPGRADE_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    (runtime.stdout ?? process.stdout).write(formatCommandHelp(UPGRADE_SPEC));
    return 0;
  }

  const env = runtime.env ?? process.env;
  const stdout = runtime.stdout ?? process.stdout;
  const stderr = runtime.stderr ?? process.stderr;
  const json = parsed.values.json === true;

  if (env.LAUREL_NO_UPDATE_CHECK === '1') {
    const message = 'Upgrade skipped because LAUREL_NO_UPDATE_CHECK=1 is set.';
    if (json) {
      stdout.write(`${JSON.stringify({ skipped: true, reason: 'LAUREL_NO_UPDATE_CHECK' })}\n`);
    } else {
      stdout.write(`${message}\n`);
    }
    return 0;
  }

  const plan = detectUpgradePlan({
    argv: runtime.argv ?? process.argv,
    env,
    realpath: runtime.realpath,
    exists: runtime.exists,
  });
  const dryRun = parsed.values['dry-run'] === true;

  if (dryRun || !plan.selfUpdatable) {
    if (json) {
      stdout.write(
        `${JSON.stringify({
          method: plan.method,
          command: plan.command,
          self_updatable: plan.selfUpdatable,
          dry_run: dryRun,
          reason: plan.reason,
        })}\n`,
      );
    } else {
      stdout.write(`${plan.reason}\n`);
      stdout.write(`Run: ${formatShellCommand(plan.command)}\n`);
    }
    return plan.method === 'unknown' ? 2 : 0;
  }

  if (!json) {
    stdout.write(`Detected ${plan.reason}\n`);
    stdout.write(`Running: ${formatShellCommand(plan.command)}\n`);
  }

  const proc = (runtime.spawn ?? Bun.spawn)(plan.command, {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await proc.exited;
  if (json) {
    stdout.write(
      `${JSON.stringify({
        method: plan.method,
        command: plan.command,
        self_updatable: true,
        exit_code: exitCode,
      })}\n`,
    );
  } else if (exitCode !== 0) {
    stderr.write(`Upgrade command failed with exit code ${exitCode}.\n`);
  }
  return exitCode;
}

export function detectUpgradePlan(runtime: UpgradeRuntime = {}): UpgradePlan {
  const env = runtime.env ?? process.env;
  const paths = collectExecutablePaths(runtime);
  const joined = paths.map((p) => normalize(p)).join('\n');
  const lower = joined.toLowerCase();
  const userAgent = env.npm_config_user_agent?.toLowerCase() ?? '';
  const execPath = env.npm_execpath?.toLowerCase() ?? '';

  if (lower.includes('/homebrew/cellar/') || lower.includes('/cellar/laurel/')) {
    return {
      method: 'homebrew',
      command: ['brew', 'upgrade', PACKAGE_NAME],
      selfUpdatable: true,
      reason: 'Homebrew install detected.',
    };
  }

  if (lower.includes('/.bun/install/cache/')) {
    return {
      method: 'bunx',
      command: ['bunx', `${PACKAGE_NAME}@latest`],
      selfUpdatable: false,
      reason: '`bunx` install detected; one-shot installs are not upgraded in place.',
    };
  }

  if (lower.includes('/.bun/install/global/') || lower.includes('/.bun/bin/laurel')) {
    return {
      method: 'bun-global',
      command: ['bun', 'install', '-g', `${PACKAGE_NAME}@latest`],
      selfUpdatable: true,
      reason: '`bun install -g` install detected.',
    };
  }

  if (lower.includes('/node_modules/laurel/') || lower.includes('/node_modules/.bin/laurel')) {
    return {
      method: 'npm-global',
      command: ['npm', 'install', '-g', `${PACKAGE_NAME}@latest`],
      selfUpdatable: true,
      reason: '`npm install -g` install detected.',
    };
  }

  if (userAgent.startsWith('bunx/')) {
    return {
      method: 'bunx',
      command: ['bunx', `${PACKAGE_NAME}@latest`],
      selfUpdatable: false,
      reason: '`bunx` install detected; one-shot installs are not upgraded in place.',
    };
  }

  if (execPath.includes('/bun') || userAgent.startsWith('bun/')) {
    return {
      method: 'bun-global',
      command: ['bun', 'install', '-g', `${PACKAGE_NAME}@latest`],
      selfUpdatable: true,
      reason: '`bun install -g` install detected.',
    };
  }

  if (execPath.includes('/npm') || userAgent.startsWith('npm/')) {
    return {
      method: 'npm-global',
      command: ['npm', 'install', '-g', `${PACKAGE_NAME}@latest`],
      selfUpdatable: true,
      reason: '`npm install -g` install detected.',
    };
  }

  return {
    method: 'unknown',
    command: ['npm', 'install', '-g', `${PACKAGE_NAME}@latest`],
    selfUpdatable: false,
    reason:
      'Could not determine how Laurel was installed, so no self-update command was run automatically.',
  };
}

function collectExecutablePaths(runtime: UpgradeRuntime): string[] {
  const argv = runtime.argv ?? process.argv;
  const exists = runtime.exists ?? existsSync;
  const realpath = runtime.realpath ?? ((path: string) => realpathSync(path));
  const paths = new Set<string>();

  for (const candidate of [argv[1]]) {
    if (!candidate) continue;
    paths.add(candidate);
    try {
      if (exists(candidate)) {
        paths.add(realpath(candidate));
      }
    } catch {
      // Best-effort install detection; failures fall through to other signals.
    }
  }

  return Array.from(paths);
}

function formatShellCommand(command: string[]): string {
  return command.map(shellQuote).join(' ');
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
