import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..');
const sampleDir = join(root, 'examples', 'docker');

describe('examples/docker nginx-alpine sample', () => {
  test('builds a slim nginx image from an already-built Laurel dist directory', async () => {
    const body = await readFile(join(sampleDir, 'Dockerfile'), 'utf8');

    expect(body).toContain('FROM nginx:1.27-alpine');
    expect(body).toContain('COPY nginx.conf /etc/nginx/conf.d/default.conf');
    expect(body).toContain('COPY dist/ /usr/share/nginx/html/');
    expect(body).toContain('EXPOSE 80');
    expect(body).toContain('HEALTHCHECK CMD wget -q -O /dev/null http://localhost/healthz');
  });

  test('builds Laurel inside a Bun stage before serving dist with nginx', async () => {
    const body = await readFile(join(sampleDir, 'Dockerfile.multi-stage'), 'utf8');

    expect(body).toContain('FROM oven/bun AS build');
    expect(body).toContain('RUN bun install');
    expect(body).toContain('RUN bunx laurel build');
    expect(body).toContain('FROM nginx:1.27-alpine');
    expect(body).toContain('COPY nginx.conf /etc/nginx/conf.d/default.conf');
    expect(body).toContain('COPY --from=build /app/dist/ /usr/share/nginx/html/');
    expect(body).toContain('EXPOSE 80');
    expect(body).toContain('HEALTHCHECK CMD wget -q -O /dev/null http://localhost/healthz');
  });

  test('ships a multi-stage dockerignore that trims local build context bloat', async () => {
    const body = await readFile(join(sampleDir, '.dockerignore'), 'utf8');
    const entries = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    expect(entries).toContain('.git/');
    expect(entries).toContain('node_modules/');
    expect(entries).toContain('dist/');
  });

  test('serves Laurel static output with pretty URLs and the generated 404 page', async () => {
    const body = await readFile(join(sampleDir, 'nginx.conf'), 'utf8');

    expect(body).toContain('listen 80;');
    expect(body).toContain('root /usr/share/nginx/html;');
    expect(body).toContain('try_files $uri $uri/ $uri/index.html =404;');
    expect(body).toContain('error_page 404 /404.html;');
    expect(body).toContain('location = /404.html {');
    expect(body).toContain('internal;');
    expect(body).toContain('try_files /404.html =404;');
    expect(body).toContain('location = /healthz {');
    expect(body).toContain('access_log off;');
    expect(body).toContain('return 200 "ok\\n";');
  });

  test('provides a compose snippet for reverse proxy deployments', async () => {
    const body = await readFile(join(sampleDir, 'docker-compose.yml'), 'utf8');

    expect(body).toContain('dockerfile: Dockerfile.multi-stage');
    expect(body).toContain('expose:');
    expect(body).toContain('- "80"');
    expect(body).toContain('traefik.http.routers.laurel.rule');
    expect(body).toContain('traefik.http.services.laurel.loadbalancer.server.port: "80"');
    expect(body).toContain('reverse_proxy laurel:80');
    expect(body).toContain('external: true');
  });

  test('is linked from the Docker deploy docs, deploy tutorial, and examples index', async () => {
    const dockerDocs = await readFile(join(root, 'docs', 'deploy', 'docker.md'), 'utf8');
    const deployTutorial = await readFile(join(root, 'docs', 'tutorials', '04-deploy.md'), 'utf8');
    const examplesIndex = await readFile(join(root, 'examples', 'README.md'), 'utf8');

    for (const body of [dockerDocs, deployTutorial, examplesIndex]) {
      expect(body).toContain('examples/docker/Dockerfile');
      expect(body).toContain('examples/docker/Dockerfile.multi-stage');
      expect(body).toContain('examples/docker/.dockerignore');
      expect(body).toContain('examples/docker/nginx.conf');
      expect(body).toContain('examples/docker/docker-compose.yml');
    }
  });
});
