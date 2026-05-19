import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProfiler, writeProfile } from '~/build/profile.ts';

describe('createProfiler', () => {
  test('records a phase entry when stop() is called', () => {
    const p = createProfiler();
    const stop = p.start('config');
    stop();
    expect(p.entries.length).toBe(1);
    const entry = p.entries[0];
    expect(entry?.phase).toBe('config');
    expect(typeof entry?.duration_ms).toBe('number');
    expect(entry?.route).toBeUndefined();
    expect(entry?.bytes_emitted).toBeUndefined();
  });

  test('records route + bytes_emitted when provided', () => {
    const p = createProfiler();
    const stop = p.start('render', '/hello/');
    stop({ bytes_emitted: 1234 });
    expect(p.entries[0]).toMatchObject({
      phase: 'render',
      route: '/hello/',
      bytes_emitted: 1234,
    });
  });

  test('preserves insertion order across multiple phases', () => {
    const p = createProfiler();
    p.start('a')();
    p.start('b')();
    p.start('c')();
    expect(p.entries.map((e) => e.phase)).toEqual(['a', 'b', 'c']);
  });

  test('rounds duration_ms to three decimal places via record()', () => {
    const p = createProfiler();
    p.record({ phase: 'manual', duration_ms: 12.3456789 });
    expect(p.entries[0]?.duration_ms).toBe(12.346);
  });
});

describe('writeProfile', () => {
  test('writes profile.json under <outputDir>/.nectar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-profile-'));
    const p = createProfiler();
    p.record({ phase: 'config', duration_ms: 1.5 });
    p.record({ phase: 'render', duration_ms: 4.2, route: '/', bytes_emitted: 1024 });
    await writeProfile(dir, p);
    const file = join(dir, '.nectar/profile.json');
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Array<Record<string, unknown>>;
    expect(parsed).toEqual([
      { phase: 'config', duration_ms: 1.5 },
      { phase: 'render', duration_ms: 4.2, route: '/', bytes_emitted: 1024 },
    ]);
  });
});
