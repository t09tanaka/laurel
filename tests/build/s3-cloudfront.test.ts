import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dir, '..', '..');
const terraformSample = join(
  root,
  'examples',
  'deploy',
  's3-cloudfront',
  'cloudfront-custom-errors.tf.example',
);

describe('S3 + CloudFront deploy docs', () => {
  test('document 403 and 404 custom error responses for Nectar 404 pages', async () => {
    const guide = await readFile(join(root, 'docs', 'deploy', 's3-cloudfront.md'), 'utf8');
    const tutorial = await readFile(join(root, 'docs', 'tutorials', '04-deploy.md'), 'utf8');
    const examples = await readFile(join(root, 'examples', 'README.md'), 'utf8');

    for (const body of [guide, tutorial]) {
      expect(body).toContain('CloudFront custom error responses');
      expect(body).toContain('`403`');
      expect(body).toContain('`404`');
      expect(body).toContain('/404.html');
      expect(body).toContain('successful `200`');
    }

    expect(guide).toContain('Keep the `response_code` as `404`');
    expect(guide).toContain('custom_error_response');
    expect(guide).toContain('error_code            = 403');
    expect(guide).toContain('error_code            = 404');
    expect(guide).toContain('response_code         = 404');
    expect(guide).toContain('response_page_path    = "/404.html"');
    expect(guide).toContain('CustomErrorResponses:');
    expect(guide).toContain('ErrorCode: 403');
    expect(guide).toContain('ErrorCode: 404');
    expect(guide).toContain('ResponseCode: 404');
    expect(tutorial).toContain('keep the viewer response code as\n`404`');
    expect(examples).toContain('cloudfront-custom-errors.tf.example');
  });

  test('documents the build-emitted CloudFront invalidation path list', async () => {
    const guide = await readFile(join(root, 'docs', 'deploy', 's3-cloudfront.md'), 'utf8');
    const workflow = await readFile(join(root, 'examples', 'ci', 's3-cloudfront.yml'), 'utf8');

    expect(guide).toContain('dist/.nectar/changed-paths.txt');
    expect(guide).toContain('aws cloudfront create-invalidation');
    expect(guide).toContain('--paths $(cat dist/.nectar/changed-paths.txt)');
    expect(guide).toContain('/*');
    expect(workflow).toContain('dist/.nectar/changed-paths.txt');
    expect(workflow).toContain('--paths $(cat dist/.nectar/changed-paths.txt)');
  });
});

describe('S3 + CloudFront deploy samples', () => {
  test('include a Terraform custom error response fragment that preserves 404 status', async () => {
    expect(existsSync(terraformSample)).toBe(true);

    const body = await readFile(terraformSample, 'utf8');

    expect(body).toContain('custom_error_response');
    expect(body).toContain('error_code            = 403');
    expect(body).toContain('error_code            = 404');
    expect(body).toContain('response_code         = 404');
    expect(body).toContain('response_page_path    = "/404.html"');
    expect(body).not.toContain('response_code         = 200');
  });
});
