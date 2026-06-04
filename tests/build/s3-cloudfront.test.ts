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
const terraformDir = join(root, 'examples', 'deploy', 's3-cloudfront', 'terraform');
const cloudFrontRedirectSample = join(
  root,
  'examples',
  'deploy',
  's3-cloudfront',
  'cloudfront-redirects.js',
);

describe('S3 + CloudFront deploy docs', () => {
  test('document 403 and 404 custom error responses for Laurel 404 pages', async () => {
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
    expect(guide).toContain('Terraform OAC sample');
    expect(guide).toContain('examples/deploy/s3-cloudfront/terraform/');
    expect(guide).toContain('Origin Access Control (OAC), not legacy');
    expect(guide).toContain('AWS:SourceArn');
    expect(guide).toContain('cloudfront-redirects.js');
    expect(guide).toContain('scripts/generate-cloudfront-redirects.ts');
    expect(guide).toContain('CloudFront Function for redirects');
    expect(tutorial).toContain('keep the viewer response code as\n`404`');
    expect(tutorial).toContain('cloudfront-redirects.js');
    expect(examples).toContain('cloudfront-custom-errors.tf.example');
    expect(examples).toContain('deploy/s3-cloudfront/terraform/');
    expect(examples).toContain('cloudfront-redirects.js');
  });

  test('documents the build-emitted CloudFront invalidation path list', async () => {
    const guide = await readFile(join(root, 'docs', 'deploy', 's3-cloudfront.md'), 'utf8');
    const workflow = await readFile(join(root, 'examples', 'ci', 's3-cloudfront.yml'), 'utf8');

    expect(guide).toContain('dist/.laurel/changed-paths.txt');
    expect(guide).toContain('aws cloudfront create-invalidation');
    expect(guide).toContain('--paths $(cat dist/.laurel/changed-paths.txt)');
    expect(guide).toContain('/*');
    expect(workflow).toContain('dist/.laurel/changed-paths.txt');
    expect(workflow).toContain('--paths $(cat dist/.laurel/changed-paths.txt)');
  });

  test('documents the generated CloudFront response headers policy config', async () => {
    const guide = await readFile(join(root, 'docs', 'deploy', 's3-cloudfront.md'), 'utf8');

    expect(guide).toContain('dist/.laurel/cloudfront-response-headers-policy.json');
    expect(guide).toContain('aws cloudfront create-response-headers-policy');
    expect(guide).toContain(
      '--response-headers-policy-config file://dist/.laurel/cloudfront-response-headers-policy.json',
    );
    expect(guide).toContain('[deploy.headers].security');
    expect(guide).toContain('deploy.headers.cache_rules');
    expect(guide).toContain('Response Headers Policy applies uniformly');
  });

  test('short recipe documents S3 lifecycle controls', async () => {
    const recipe = await readFile(join(root, 'docs', 'deployment', 's3-cloudfront.md'), 'utf8');

    expect(recipe).toContain('Lifecycle controls');
    expect(recipe).toContain('assets/built/');
    expect(recipe).toContain('expire non-current versions');
    expect(recipe).toContain('after 30 days');
    expect(recipe).toContain('access logs');
    expect(recipe).toContain('Glacier storage class');
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

  test('include a complete Terraform OAC starter for a private S3 origin', async () => {
    const main = await readFile(join(terraformDir, 'main.tf'), 'utf8');
    const variables = await readFile(join(terraformDir, 'variables.tf'), 'utf8');
    const outputs = await readFile(join(terraformDir, 'outputs.tf'), 'utf8');
    const readme = await readFile(join(terraformDir, 'README.md'), 'utf8');

    expect(main).toContain('resource "aws_s3_bucket" "site"');
    expect(main).toContain('resource "aws_s3_bucket_public_access_block" "site"');
    expect(main).toContain('resource "aws_cloudfront_distribution" "site"');
    expect(main).toContain('resource "aws_cloudfront_origin_access_control" "site"');
    expect(main).toContain(
      'origin_access_control_id = aws_cloudfront_origin_access_control.site.id',
    );
    expect(main).toContain('signing_behavior                  = "always"');
    expect(main).toContain('signing_protocol                  = "sigv4"');
    expect(main).toContain('resource "aws_s3_bucket_policy" "allow_cloudfront_oac_read"');
    expect(main).toContain('identifiers = ["cloudfront.amazonaws.com"]');
    expect(main).toContain('variable = "AWS:SourceArn"');
    expect(main).toContain('values   = [aws_cloudfront_distribution.site.arn]');
    expect(main).toContain('response_page_path    = "/404.html"');
    expect(main).not.toContain('origin_access_identity');
    expect(main).not.toContain('aws_cloudfront_origin_access_identity');

    expect(variables).toContain('variable "bucket_name"');
    expect(outputs).toContain('output "cloudfront_distribution_id"');
    expect(readme).toContain('OAC, not the legacy Origin Access Identity (OAI)');
    expect(readme).toContain('../cloudfront-custom-errors.tf.example');
  });

  test('include a CloudFront Function sample for redirects generated from redirects.yaml', async () => {
    expect(existsSync(cloudFrontRedirectSample)).toBe(true);

    const body = await readFile(cloudFrontRedirectSample, 'utf8');

    expect(body).toContain('CloudFront Function');
    expect(body).toContain('viewer-request');
    expect(body).toContain('const REDIRECTS =');
    expect(body).toContain('function handler(event)');
    expect(body).toContain('REDIRECTS[request.uri]');
    expect(body).toContain('statusCode: rule.statusCode');
    expect(body).toContain('location: { value: location }');
  });
});
