import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DeployTargetRegistry,
  type DeploymentArtifacts,
  deploymentHeaderTargets,
  deploymentRoutingTargets,
  emitDeployHeaders,
  emitDeployTargets,
} from '~/build/emitters/registry.ts';
import { configSchema } from '~/config/schema.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'laurel-deploy-registry-'));
}

function makeArtifacts(
  outputDir: string,
  configInput: unknown = { site: { title: 'x' } },
): DeploymentArtifacts {
  return {
    outputDir,
    config: configSchema.parse(configInput),
    routes: [],
    userRedirects: [{ from: '/old', to: '/new', status: 308, force: true }],
    deployRedirects: [{ from: '/old', to: '/new', status: 308, force: true }],
  };
}

describe('DeployTargetRegistry', () => {
  test('lists, looks up, and emits targets in registration order', async () => {
    const calls: string[] = [];
    const registry = new DeployTargetRegistry([
      {
        name: 'first',
        emit: () => {
          calls.push('first');
        },
      },
      {
        name: 'second',
        emit: () => {
          calls.push('second');
        },
      },
    ]);

    expect(registry.list().map((target) => target.name)).toEqual(['first', 'second']);
    expect(registry.get('second')?.name).toBe('second');
    expect(registry.get('missing')).toBeUndefined();

    const outputDir = await makeOutputDir();
    await emitDeployTargets(registry, makeArtifacts(outputDir));

    expect(calls).toEqual(['first', 'second']);
  });

  test('header targets apply the shared rules through each target delivery channel', async () => {
    const outputDir = await makeOutputDir();
    const artifacts = makeArtifacts(outputDir, {
      site: { title: 'x' },
      deploy: {
        netlify: { enabled: true },
        cloudflare_workers: { enabled: true },
      },
    });

    await emitDeployHeaders(deploymentHeaderTargets, artifacts);

    const headersBody = await readFile(join(outputDir, '_headers'), 'utf8');
    expect(headersBody).toContain('X-Content-Type-Options: nosniff');
    expect(headersBody).toContain('Referrer-Policy: strict-origin-when-cross-origin');

    const workersBody = JSON.parse(
      await readFile(join(outputDir, '_routes-manifest.json'), 'utf8'),
    ) as {
      redirects: Array<{ source: string; destination: string; status: number }>;
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };
    expect(workersBody.redirects).toContainEqual({
      source: '/old',
      destination: '/new',
      status: 308,
    });
    expect(workersBody.headers).toContainEqual(
      expect.objectContaining({
        source: '/*',
        headers: expect.arrayContaining([
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ]),
      }),
    );
  });

  test('header targets honor preview noindex providers', async () => {
    const outputDir = await makeOutputDir();
    const artifacts = makeArtifacts(outputDir);
    artifacts.autoNoindexProvider = 'netlify';

    await emitDeployHeaders(deploymentHeaderTargets, artifacts);

    const body = await readFile(join(outputDir, '_headers'), 'utf8');
    expect(body).toContain('X-Content-Type-Options: nosniff');
    expect(body).toContain('Referrer-Policy: strict-origin-when-cross-origin');
  });

  test('Cloudflare Pages routing target emits routes and redirects from deployment artifacts', async () => {
    const outputDir = await makeOutputDir();
    const artifacts = makeArtifacts(outputDir, {
      site: { title: 'x' },
      deploy: { cloudflare_pages: { enabled: true } },
    });

    await emitDeployTargets(deploymentRoutingTargets, artifacts);

    expect(existsSync(join(outputDir, '_routes.json'))).toBe(true);
    const redirects = await readFile(join(outputDir, '_redirects'), 'utf8');
    expect(redirects).toContain('/old  /new  308');
  });

  test('Vercel routing target emits headers and redirects through the registry', async () => {
    const outputDir = await makeOutputDir();
    const artifacts = makeArtifacts(outputDir, {
      site: { title: 'x' },
      deploy: { vercel: { enabled: true } },
    });

    await emitDeployTargets(deploymentRoutingTargets, artifacts);

    const body = JSON.parse(await readFile(join(outputDir, 'vercel.json'), 'utf8')) as {
      headers: Array<{ source: string }>;
      redirects: Array<{ source: string; destination: string; statusCode: number }>;
    };
    expect(body.headers.map((rule) => rule.source)).toContain('/(.*)');
    expect(body.redirects).toContainEqual({
      source: '/old',
      destination: '/new',
      statusCode: 308,
    });
  });
});
