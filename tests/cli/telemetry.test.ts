import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCrashReportPayload,
  handleCrashReportPrompt,
  readTelemetryConfig,
  redactArgv,
  sanitizeStack,
} from '~/cli/telemetry.ts';

describe('cli telemetry crash reports', () => {
  test('redacts option values from argv while keeping command shape', () => {
    expect(
      redactArgv([
        'bun',
        '/repo/src/cli/index.ts',
        'build',
        '--config',
        '/Users/me/private/nectar.toml',
        '--base-url=https://secret.example',
        '-p',
        '4000',
        '-o=dist-private',
        '-csecret.toml',
        '--strict',
        'positional-secret',
      ]),
    ).toEqual([
      'bun',
      '[entry]',
      'build',
      '--config',
      '[redacted]',
      '--base-url=[redacted]',
      '-p',
      '[redacted]',
      '-o=[redacted]',
      '-c[redacted]',
      '--strict',
      '[arg]',
    ]);
  });

  test('sanitizes stack paths and preserves error frames', () => {
    const stack = [
      'TypeError: boom',
      '    at run (/Users/me/site/src/cli/index.ts:10:5)',
      '    at Object.<anonymous> (/tmp/nectar-fixture/secret.js:2:1)',
    ].join('\n');

    expect(sanitizeStack(stack)).toEqual(
      [
        'TypeError: boom',
        '    at run ([path]:10:5)',
        '    at Object.<anonymous> ([path]:2:1)',
      ].join('\n'),
    );
  });

  test('payload includes error identity, redacted argv, sanitized stack, and versions', () => {
    const err = new TypeError('token abc123 failed');
    err.stack = 'TypeError: token abc123 failed\n    at run (/Users/me/site/src/cli/index.ts:10:5)';

    const payload = buildCrashReportPayload(err, {
      argv: ['bun', '/repo/src/cli/index.ts', 'build', '--config', 'secret.toml'],
      versions: { nectar: '0.1.0', bun: '1.3.14', node: 'v24.0.0', commit: 'abc' },
    });

    expect(payload.error).toEqual({ class: 'TypeError', message: 'token abc123 failed' });
    expect(payload.argv).toEqual(['bun', '[entry]', 'build', '--config', '[redacted]']);
    expect(payload.stack).toBe('TypeError: token abc123 failed\n    at run ([path]:10:5)');
    expect(payload.versions).toEqual({
      nectar: '0.1.0',
      bun: '1.3.14',
      node: 'v24.0.0',
      commit: 'abc',
    });
  });

  test('non-TTY skips prompt and sender', async () => {
    let sent = false;
    const result = await handleCrashReportPrompt(new Error('boom'), {
      argv: ['bun', 'nectar', 'build'],
      versions: { nectar: '0.1.0', bun: null, node: 'v24.0.0', commit: null },
      isTty: false,
      prompt: async () => 'y',
      send: async () => {
        sent = true;
      },
    });

    expect(result).toBe('skipped-non-tty');
    expect(sent).toBe(false);
  });

  test('yes answer sends sanitized payload through the injected sender', async () => {
    let payload: ReturnType<typeof buildCrashReportPayload> | undefined;
    const result = await handleCrashReportPrompt(new Error('boom'), {
      argv: ['bun', '/repo/src/cli/index.ts', 'build', '--config', 'secret.toml'],
      versions: { nectar: '0.1.0', bun: null, node: 'v24.0.0', commit: null },
      isTty: true,
      prompt: async () => 'y',
      send: async (nextPayload) => {
        payload = nextPayload;
        return true;
      },
    });

    expect(result).toBe('sent');
    expect(payload?.argv).toEqual(['bun', '[entry]', 'build', '--config', '[redacted]']);
  });

  test('never answer is stored and suppresses later prompts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-telemetry-'));
    const configPath = join(dir, 'telemetry.json');
    let promptCount = 0;
    try {
      const first = await handleCrashReportPrompt(new Error('boom'), {
        argv: ['bun', 'nectar', 'build'],
        versions: { nectar: '0.1.0', bun: null, node: 'v24.0.0', commit: null },
        configPath,
        isTty: true,
        prompt: async () => {
          promptCount += 1;
          return 'never';
        },
        send: async () => {
          throw new Error('send should not run');
        },
      });
      const second = await handleCrashReportPrompt(new Error('boom'), {
        argv: ['bun', 'nectar', 'build'],
        versions: { nectar: '0.1.0', bun: null, node: 'v24.0.0', commit: null },
        configPath,
        isTty: true,
        prompt: async () => {
          promptCount += 1;
          return 'y';
        },
        send: async () => {
          throw new Error('send should not run');
        },
      });

      expect(first).toBe('stored-never');
      expect(second).toBe('skipped-never');
      expect(promptCount).toBe(1);
      expect(await readTelemetryConfig(configPath)).toEqual({ crashReports: 'never' });
      expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ crashReports: 'never' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
