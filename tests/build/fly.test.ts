import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import TOML from '@iarna/toml';

const root = join(import.meta.dir, '..', '..');
const sampleDir = join(root, 'examples', 'fly');

describe('Fly.io deploy sample', () => {
  test('includes fly.toml, Dockerfile, and nginx.conf under examples/fly', () => {
    expect(existsSync(join(sampleDir, 'fly.toml'))).toBe(true);
    expect(existsSync(join(sampleDir, 'Dockerfile'))).toBe(true);
    expect(existsSync(join(sampleDir, 'nginx.conf'))).toBe(true);
  });

  test('configures Fly to build a static nginx machine on port 80', async () => {
    const body = await readFile(join(sampleDir, 'fly.toml'), 'utf8');

    expect(body).toContain('app = "my-laurel-site"');
    expect(body).toContain('[build]');
    expect(body).toContain('dockerfile = "Dockerfile"');
    expect(body).toContain('[http_service]');
    expect(body).toContain('internal_port = 80');
    expect(body).toContain('auto_stop_machines = "stop"');
    expect(body).toContain('auto_start_machines = true');
    expect(body).toContain('[[http_service.checks]]');
    expect(body).toContain('path = "/healthz"');
  });

  test('parses Fly http_service health checks for the nginx health endpoint', async () => {
    const body = await readFile(join(sampleDir, 'fly.toml'), 'utf8');
    const config = TOML.parse(body) as {
      http_service?: { checks?: Array<Record<string, unknown>> };
    };

    expect(config.http_service?.checks).toEqual([
      {
        interval: '30s',
        timeout: '5s',
        grace_period: '10s',
        method: 'GET',
        path: '/healthz',
      },
    ]);
  });

  test('copies Laurel dist output and generated nginx config into the image', async () => {
    const body = await readFile(join(sampleDir, 'Dockerfile'), 'utf8');

    expect(body).toContain('FROM nginx:');
    expect(body).toContain('COPY dist/.laurel/nginx.conf /etc/nginx/conf.d/default.conf');
    expect(body).toContain('COPY dist/ /usr/share/nginx/html/');
    expect(body).toContain('RUN rm -rf /usr/share/nginx/html/.laurel');
  });

  test('keeps the checked-in nginx.conf as the static-only fallback config', async () => {
    const body = await readFile(join(sampleDir, 'nginx.conf'), 'utf8');

    expect(body).toContain('Static-only fallback');
    expect(body).toContain('dist/.laurel/nginx.conf');
    expect(body).toContain('root /usr/share/nginx/html;');
    expect(body).toContain('error_page 404 /404.html;');
    expect(body).toContain('location = /healthz {');
    expect(body).toContain('access_log off;');
    expect(body).toContain('return 200 "ok\\n";');
    expect(body).toContain('internal;');
    expect(body).toContain('try_files $uri $uri/ $uri/index.html =404;');
    expect(body).toContain('try_files /404.html =404;');
  });

  test('is linked from deploy docs, the tutorial, and examples catalog', async () => {
    const guide = await readFile(join(root, 'docs', 'deploy', 'fly.md'), 'utf8');
    const tutorial = await readFile(join(root, 'docs', 'tutorials', '04-deploy.md'), 'utf8');
    const examples = await readFile(join(root, 'examples', 'README.md'), 'utf8');

    expect(guide).toContain('examples/fly/fly.toml');
    expect(guide).toContain('examples/fly/Dockerfile');
    expect(guide).toContain('examples/fly/nginx.conf');
    expect(guide).toContain('root = "/usr/share/nginx/html"');
    expect(guide).toContain('dist/.laurel/nginx.conf');
    expect(guide).toContain('path = "/healthz"');
    expect(tutorial).toContain('examples/fly/fly.toml');
    expect(tutorial).toContain('examples/fly/Dockerfile');
    expect(tutorial).toContain('root = "/usr/share/nginx/html"');
    expect(tutorial).toContain('dist/.laurel/nginx.conf');
    expect(tutorial).toContain('path = "/healthz"');
    expect(examples).toContain('examples/fly/fly.toml');
  });
});
