#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_TEMPLATE = fileURLToPath(
  new URL('../packaging/homebrew/Formula/laurel.rb.template', import.meta.url),
);
const DEFAULT_OUTPUT = 'packaging/homebrew/Formula/laurel.rb';

const REQUIRED_ARTIFACTS = [
  ['laurel-darwin-arm64', '{{DARWIN_ARM64_SHA256}}'],
  ['laurel-darwin-x64', '{{DARWIN_X64_SHA256}}'],
  ['laurel-linux-arm64', '{{LINUX_ARM64_SHA256}}'],
  ['laurel-linux-x64', '{{LINUX_X64_SHA256}}'],
] as const;

interface CliOptions {
  version?: string;
  shasums?: string;
  template: string;
  output?: string;
  stdout: boolean;
}

export function parseHomebrewShasums(body: string): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const [index, rawLine] of body.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line);
    if (!match) {
      throw new Error(`Invalid SHASUMS256.txt line ${index + 1}: ${rawLine}`);
    }
    const [, hash, artifact] = match;
    if (!hash || !artifact) {
      throw new Error(`Invalid SHASUMS256.txt line ${index + 1}: ${rawLine}`);
    }
    hashes.set(artifact.trim(), hash.toLowerCase());
  }
  return hashes;
}

export function normalizeHomebrewVersion(raw: string): string {
  const version = raw.trim().replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version "${raw}". Expected a semver tag like v1.2.3.`);
  }
  return version;
}

export function generateHomebrewFormula(input: {
  version: string;
  shasumsText: string;
  templateText: string;
}): string {
  const version = normalizeHomebrewVersion(input.version);
  const hashes = parseHomebrewShasums(input.shasumsText);

  let formula = input.templateText.replaceAll('{{VERSION}}', version);
  const missing: string[] = [];
  for (const [artifact, token] of REQUIRED_ARTIFACTS) {
    const hash = hashes.get(artifact);
    if (!hash) {
      missing.push(artifact);
      continue;
    }
    formula = formula.replaceAll(token, hash);
  }

  if (missing.length > 0) {
    throw new Error(`Missing Homebrew artifact checksums: ${missing.join(', ')}`);
  }
  if (formula.includes('{{')) {
    throw new Error('Homebrew formula template still contains unreplaced placeholders.');
  }
  return formula.endsWith('\n') ? formula : `${formula}\n`;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    template: DEFAULT_TEMPLATE,
    output: DEFAULT_OUTPUT,
    stdout: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--version':
        options.version = requireValue(arg, next);
        i += 1;
        break;
      case '--shasums':
        options.shasums = requireValue(arg, next);
        i += 1;
        break;
      case '--template':
        options.template = requireValue(arg, next);
        i += 1;
        break;
      case '--output':
        options.output = requireValue(arg, next);
        i += 1;
        break;
      case '--stdout':
        options.stdout = true;
        options.output = undefined;
        break;
      case '--help':
        printUsage();
        process.exit(0);
        break;
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.version) throw new Error('Missing required --version.');
  if (!options.shasums) throw new Error('Missing required --shasums.');
  return options;
}

function requireValue(name: string, value: string | undefined): string {
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}.`);
  }
  return value;
}

function printUsage(): void {
  console.log(`Usage: bun run scripts/generate-homebrew-formula.ts --version v1.2.3 --shasums dist-bin/SHASUMS256.txt [--output Formula/laurel.rb]

Generates a Homebrew formula from the checked-in template and release binary checksums.
Use --stdout instead of --output to print the formula.`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const [templateText, shasumsText] = await Promise.all([
    readFile(options.template, 'utf8'),
    readFile(options.shasums as string, 'utf8'),
  ]);
  const formula = generateHomebrewFormula({
    version: options.version as string,
    shasumsText,
    templateText,
  });

  if (options.stdout) {
    process.stdout.write(formula);
    return;
  }

  const output = options.output as string;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, formula, 'utf8');
  console.log(`Wrote ${output}`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
