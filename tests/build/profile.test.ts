import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILD_STATS_FILENAME,
  buildStatsPath,
  createProfiler,
  writeProfile,
} from '~/build/profile.ts';

describe('createProfiler', () => {
  test('records phase timings', () => {
    const p = createProfiler();
    const stop = p.startPhase('load');
    stop();
    expect(p.phases.length).toBe(1);
    const phase = p.phases[0];
    expect(phase?.name).toBe('load');
    expect(typeof phase?.durationMs).toBe('number');
    expect(phase?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('records route render timings with output metadata', () => {
    const p = createProfiler();
    const stop = p.startRoute({
      url: '/hello/',
      outputPath: 'hello/index.html',
      template: 'post.hbs',
      kind: 'post',
    });
    stop({ bytes: 1234, reused: true });
    expect(p.routes[0]).toMatchObject({
      url: '/hello/',
      outputPath: 'hello/index.html',
      template: 'post.hbs',
      kind: 'post',
      bytes: 1234,
      reused: true,
    });
    expect(p.routes[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('aggregates repeated phase names in the JSON shape', () => {
    const p = createProfiler();
    p.startPhase('load')();
    p.startPhase('plan')();
    p.startPhase('load')();
    const stats = p.toJSON({ outputDir: '/tmp/dist', routeCount: 0, assetCount: 0 });
    expect(stats.phases.map((phase) => phase.name)).toEqual(['load', 'plan']);
    expect(stats.phases[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('writeProfile', () => {
  test(`writes ${BUILD_STATS_FILENAME} under <outputDir>`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-profile-'));
    const p = createProfiler();
    p.startPhase('load')();
    p.startRoute({
      url: '/',
      outputPath: 'index.html',
      template: 'home.hbs',
      kind: 'home',
    })({ bytes: 1024, reused: false });

    await writeProfile(dir, p, { routeCount: 1, assetCount: 2 });

    const file = buildStatsPath(dir);
    expect(file).toBe(join(dir, BUILD_STATS_FILENAME));
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      outputDir: dir,
      routeCount: 1,
      assetCount: 2,
    });
    expect(parsed).toHaveProperty('generatedAt');
    expect(parsed).toHaveProperty('totalDurationMs');
    expect(parsed).toHaveProperty('phases');
    expect(parsed).toHaveProperty('routes');
  });
});
