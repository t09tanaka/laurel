import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..');
const sampleDir = join(root, 'examples', 'docker');

describe('examples/docker nginx-alpine sample', () => {
  test('builds a slim nginx image from an already-built Nectar dist directory', async () => {
    const body = await readFile(join(sampleDir, 'Dockerfile'), 'utf8');

    expect(body).toContain('FROM nginx:1.27-alpine');
    expect(body).toContain('COPY nginx.conf /etc/nginx/conf.d/default.conf');
    expect(body).toContain('COPY dist/ /usr/share/nginx/html/');
    expect(body).toContain('EXPOSE 80');
  });

  test('builds Nectar inside a Bun stage before serving dist with nginx', async () => {
    const body = await readFile(join(sampleDir, 'Dockerfile.multi-stage'), 'utf8');

    expect(body).toContain('FROM oven/bun AS build');
    expect(body).toContain('RUN bun install');
    expect(body).toContain('RUN bunx nectar build');
    expect(body).toContain('FROM nginx:1.27-alpine');
    expect(body).toContain('COPY nginx.conf /etc/nginx/conf.d/default.conf');
    expect(body).toContain('COPY --from=build /app/dist/ /usr/share/nginx/html/');
    expect(body).toContain('EXPOSE 80');
  });

  test('serves Nectar static output with pretty URLs and the generated 404 page', async () => {
    const body = await readFile(join(sampleDir, 'nginx.conf'), 'utf8');

    expect(body).toContain('listen 80;');
    expect(body).toContain('root /usr/share/nginx/html;');
    expect(body).toContain('try_files $uri $uri/ $uri/index.html =404;');
    expect(body).toContain('error_page 404 /404.html;');
  });

  test('is linked from the Docker deploy docs, deploy tutorial, and examples index', async () => {
    const dockerDocs = await readFile(join(root, 'docs', 'deploy', 'docker.md'), 'utf8');
    const deployTutorial = await readFile(join(root, 'docs', 'tutorials', '04-deploy.md'), 'utf8');
    const examplesIndex = await readFile(join(root, 'examples', 'README.md'), 'utf8');

    for (const body of [dockerDocs, deployTutorial, examplesIndex]) {
      expect(body).toContain('examples/docker/Dockerfile');
      expect(body).toContain('examples/docker/Dockerfile.multi-stage');
      expect(body).toContain('examples/docker/nginx.conf');
    }
  });
});
