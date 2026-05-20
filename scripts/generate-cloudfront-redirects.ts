#!/usr/bin/env bun
import { resolve } from 'node:path';
import { generateCloudFrontRedirectFunction } from '../src/build/cloudfront-redirects.ts';

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(
    [
      'Usage: bun scripts/generate-cloudfront-redirects.ts [--cwd <site-root>] --out <file>',
      '',
      'Reads redirects.yaml from <site-root> (default: current directory) and writes',
      'a CloudFront Function with the redirect map inlined.',
    ].join('\n'),
  );
  process.exit(0);
}

const output = valueAfter('--out');
if (!output) {
  console.error('Missing required --out <file>.');
  process.exit(1);
}

const cwd = resolve(valueAfter('--cwd') ?? process.cwd());
const outputPath = resolve(output);

await generateCloudFrontRedirectFunction({ cwd, outputPath });
console.log(`Wrote ${outputPath}`);
