import { describe, expect, test } from 'bun:test';
import { detectUpgradePlan, runUpgrade } from '~/cli/commands/upgrade.ts';

function fakeFs(real: string) {
  return {
    exists: () => true,
    realpath: () => real,
  };
}

function makeWriter() {
  let value = '';
  return {
    stream: {
      write(chunk: string) {
        value += chunk;
        return true;
      },
    },
    read: () => value,
  };
}

describe('cli upgrade', () => {
  test('detects bun global installs', () => {
    const plan = detectUpgradePlan({
      argv: ['bun', '/Users/me/.bun/bin/nectar'],
      ...fakeFs('/Users/me/.bun/install/global/node_modules/nectar/dist/cli.mjs'),
    });

    expect(plan.method).toBe('bun-global');
    expect(plan.selfUpdatable).toBe(true);
    expect(plan.command).toEqual(['bun', 'install', '-g', 'nectar@latest']);
  });

  test('detects npm global installs', () => {
    const plan = detectUpgradePlan({
      argv: ['node', '/usr/local/lib/node_modules/nectar/dist/cli.mjs'],
      ...fakeFs('/usr/local/lib/node_modules/nectar/dist/cli.mjs'),
    });

    expect(plan.method).toBe('npm-global');
    expect(plan.selfUpdatable).toBe(true);
    expect(plan.command).toEqual(['npm', 'install', '-g', 'nectar@latest']);
  });

  test('detects bunx one-shot installs as non-self-updatable', () => {
    const plan = detectUpgradePlan({
      argv: ['bun', '/Users/me/.bun/install/cache/nectar@0.1.0/node_modules/.bin/nectar'],
      ...fakeFs('/Users/me/.bun/install/cache/nectar@0.1.0/node_modules/nectar/dist/cli.mjs'),
    });

    expect(plan.method).toBe('bunx');
    expect(plan.selfUpdatable).toBe(false);
    expect(plan.command).toEqual(['bunx', 'nectar@latest']);
  });

  test('detects Homebrew installs', () => {
    const plan = detectUpgradePlan({
      argv: ['bun', '/opt/homebrew/bin/nectar'],
      ...fakeFs('/opt/homebrew/Cellar/nectar/0.1.0/bin/nectar'),
    });

    expect(plan.method).toBe('homebrew');
    expect(plan.selfUpdatable).toBe(true);
    expect(plan.command).toEqual(['brew', 'upgrade', 'nectar']);
  });

  test('dry-run prints the command without spawning it', async () => {
    const stdout = makeWriter();
    const calls: string[][] = [];
    const exitCode = await runUpgrade(['--dry-run'], {
      argv: ['bun', '/Users/me/.bun/bin/nectar'],
      ...fakeFs('/Users/me/.bun/install/global/node_modules/nectar/dist/cli.mjs'),
      stdout: stdout.stream,
      spawn: ((command: string[]) => {
        calls.push(command);
        return { exited: Promise.resolve(0) };
      }) as typeof Bun.spawn,
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([]);
    expect(stdout.read()).toContain('Run: bun install -g nectar@latest');
  });

  test('NECTAR_NO_UPDATE_CHECK skips detection and command execution', async () => {
    const stdout = makeWriter();
    const calls: string[][] = [];
    const exitCode = await runUpgrade([], {
      env: { NECTAR_NO_UPDATE_CHECK: '1' },
      argv: ['bun', '/Users/me/.bun/bin/nectar'],
      ...fakeFs('/Users/me/.bun/install/global/node_modules/nectar/dist/cli.mjs'),
      stdout: stdout.stream,
      spawn: ((command: string[]) => {
        calls.push(command);
        return { exited: Promise.resolve(0) };
      }) as typeof Bun.spawn,
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([]);
    expect(stdout.read()).toContain('NECTAR_NO_UPDATE_CHECK=1');
  });

  test('self-updatable installs run the detected command', async () => {
    const stdout = makeWriter();
    const calls: string[][] = [];
    const exitCode = await runUpgrade([], {
      argv: ['node', '/usr/local/lib/node_modules/nectar/dist/cli.mjs'],
      ...fakeFs('/usr/local/lib/node_modules/nectar/dist/cli.mjs'),
      stdout: stdout.stream,
      spawn: ((command: string[]) => {
        calls.push(command);
        return { exited: Promise.resolve(0) };
      }) as typeof Bun.spawn,
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([['npm', 'install', '-g', 'nectar@latest']]);
    expect(stdout.read()).toContain('Running: npm install -g nectar@latest');
  });
});
