import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCrashReportPayload,
  buildTelemetryPayload,
  enableTelemetry,
  handleCrashReportPrompt,
  readTelemetryConfig,
  redactArgv,
  sanitizeStack,
  sendCommandTelemetry,
  telemetryConfigPath,
} from '~/cli/telemetry.ts';

let dir: string | undefined;

async function makeEnv(): Promise<NodeJS.ProcessEnv> {
  dir = await mkdtemp(join(tmpdir(), 'laurel-telemetry-'));
  return {
    LAUREL_TELEMETRY_CONFIG: join(dir, 'telemetry.json'),
  };
}

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('cli telemetry crash reports', () => {
  test('redacts option values from argv while keeping command shape', () => {
    expect(
      redactArgv([
        'bun',
        '/repo/src/cli/index.ts',
        'build',
        '--config',
        '/Users/me/private/laurel.toml',
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
      '    at Object.<anonymous> (/tmp/laurel-fixture/secret.js:2:1)',
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
      versions: { laurel: '0.1.0', bun: '1.3.14', node: 'v24.0.0', commit: 'abc' },
    });

    expect(payload.error).toEqual({ class: 'TypeError', message: 'token abc123 failed' });
    expect(payload.argv).toEqual(['bun', '[entry]', 'build', '--config', '[redacted]']);
    expect(payload.stack).toBe('TypeError: token abc123 failed\n    at run ([path]:10:5)');
    expect(payload.versions).toEqual({
      laurel: '0.1.0',
      bun: '1.3.14',
      node: 'v24.0.0',
      commit: 'abc',
    });
  });

  test('non-TTY skips prompt and sender', async () => {
    let sent = false;
    const result = await handleCrashReportPrompt(new Error('boom'), {
      argv: ['bun', 'laurel', 'build'],
      versions: { laurel: '0.1.0', bun: null, node: 'v24.0.0', commit: null },
      isTty: false,
      prompt: async () => 'y',
      send: async () => {
        sent = true;
        return true;
      },
    });

    expect(result).toBe('skipped-non-tty');
    expect(sent).toBe(false);
  });

  test('yes answer sends sanitized payload through the injected sender', async () => {
    let payload: ReturnType<typeof buildCrashReportPayload> | undefined;
    const result = await handleCrashReportPrompt(new Error('boom'), {
      argv: ['bun', '/repo/src/cli/index.ts', 'build', '--config', 'secret.toml'],
      versions: { laurel: '0.1.0', bun: null, node: 'v24.0.0', commit: null },
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
    const env = await makeEnv();
    const configPath = telemetryConfigPath(env);
    let promptCount = 0;
    const first = await handleCrashReportPrompt(new Error('boom'), {
      argv: ['bun', 'laurel', 'build'],
      versions: { laurel: '0.1.0', bun: null, node: 'v24.0.0', commit: null },
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
      argv: ['bun', 'laurel', 'build'],
      versions: { laurel: '0.1.0', bun: null, node: 'v24.0.0', commit: null },
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
    expect(await readTelemetryConfig(configPath)).toEqual({
      enabled: false,
      crashReports: 'never',
    });
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({
      enabled: false,
      crashReports: 'never',
    });
  });
});

describe('telemetry config', () => {
  test('defaults to disabled without creating an anonymous id', async () => {
    const env = await makeEnv();
    const config = await readTelemetryConfig(env);
    expect(config).toEqual({ enabled: false });
  });

  test('enable creates a stable anonymous machine id and stores endpoint', async () => {
    const env = await makeEnv();
    const first = await enableTelemetry('https://example.test/usage', env);
    const second = await enableTelemetry(undefined, env);

    expect(first.enabled).toBe(true);
    expect(first.endpoint).toBe('https://example.test/usage');
    expect(first.anonymousMachineId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second.anonymousMachineId).toBe(first.anonymousMachineId);
    expect(telemetryConfigPath(env)).toBe(join(dir ?? '', 'telemetry.json'));
  });

  test('usage telemetry changes preserve crash report preference', async () => {
    const env = await makeEnv();
    await handleCrashReportPrompt(new Error('boom'), {
      argv: ['bun', 'laurel', 'build'],
      versions: { laurel: '0.1.0', bun: null, node: 'v24.0.0', commit: null },
      configPath: telemetryConfigPath(env),
      isTty: true,
      prompt: async () => 'never',
      send: async () => {
        throw new Error('send should not run');
      },
    });

    const enabled = await enableTelemetry('https://example.test/usage', env);

    expect(enabled).toMatchObject({
      enabled: true,
      endpoint: 'https://example.test/usage',
      crashReports: 'never',
    });
  });
});

describe('telemetry payload and sending', () => {
  test('payload contains only anonymous minimal command metadata', async () => {
    const payload = await buildTelemetryPayload({
      command: 'build',
      durationMs: 12.4,
      exitCode: 1,
      anonymousMachineId: 'anon-id',
    });

    expect(payload).toMatchObject({
      schema_version: 1,
      event: 'cli_command',
      anonymous_machine_id: 'anon-id',
      command: 'build',
      duration_ms: 12,
      success: false,
      exit_code: 1,
    });
    expect(payload.laurel_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof payload.bun_version === 'string' || payload.bun_version === null).toBe(true);
    expect(payload.os.platform).toBeTruthy();
    expect(payload.os.arch).toBeTruthy();
    expect(payload).not.toHaveProperty('cwd');
    expect(payload).not.toHaveProperty('args');
    expect(payload).not.toHaveProperty('env');
  });

  test('does not call fetch when telemetry is disabled', async () => {
    const env = await makeEnv();
    let called = false;
    const ok = await sendCommandTelemetry({
      command: 'build',
      durationMs: 1,
      exitCode: 0,
      env,
      fetchFn: async () => {
        called = true;
        return new Response(null, { status: 204 });
      },
    });

    expect(ok).toBe(false);
    expect(called).toBe(false);
  });

  test('posts to configured endpoint with injected fetch when enabled', async () => {
    const env = await makeEnv();
    await enableTelemetry('https://example.test/usage', env);
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];

    const ok = await sendCommandTelemetry({
      command: 'check',
      durationMs: 9,
      exitCode: 0,
      env,
      fetchFn: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(null, { status: 204 });
      },
    });

    expect(ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://example.test/usage');
    expect(requests[0]?.init?.method).toBe('POST');
    const body = JSON.parse(String(requests[0]?.init?.body)) as {
      command: string;
      success: boolean;
    };
    expect(body.command).toBe('check');
    expect(body.success).toBe(true);
  });

  test('environment endpoint overrides stored endpoint', async () => {
    const env = await makeEnv();
    env.LAUREL_TELEMETRY_ENDPOINT = 'https://override.test/usage';
    await enableTelemetry('https://stored.test/usage', env);
    let observedUrl = '';

    await sendCommandTelemetry({
      command: 'build',
      durationMs: 1,
      exitCode: 0,
      env,
      fetchFn: async (url) => {
        observedUrl = String(url);
        return new Response(null, { status: 204 });
      },
    });

    expect(observedUrl).toBe('https://override.test/usage');
  });
});
