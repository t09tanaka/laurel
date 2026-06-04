#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_TEMPLATE = fileURLToPath(
  new URL('../packaging/scoop/bucket/laurel.json.template', import.meta.url),
);
const DEFAULT_OUTPUT = 'packaging/scoop/bucket/laurel.json';
const WINDOWS_ARTIFACT = 'laurel-windows-x64.exe';
const WINDOWS_SHA_TOKEN = '{{WINDOWS_X64_SHA256}}';

interface CliOptions {
  version?: string;
  shasums?: string;
  template: string;
  output?: string;
  stdout: boolean;
}

export function parseScoopShasums(body: string): Map<string, string> {
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

export function normalizeScoopVersion(raw: string): string {
  const version = raw.trim().replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version "${raw}". Expected a semver tag like v1.2.3.`);
  }
  return version;
}

export function generateScoopManifest(input: {
  version: string;
  shasumsText: string;
  templateText: string;
}): string {
  const version = normalizeScoopVersion(input.version);
  const hash = parseScoopShasums(input.shasumsText).get(WINDOWS_ARTIFACT);

  if (!hash) {
    throw new Error(`Missing Scoop artifact checksum: ${WINDOWS_ARTIFACT}`);
  }

  const manifest = input.templateText
    .replaceAll('{{VERSION}}', version)
    .replaceAll(WINDOWS_SHA_TOKEN, hash);

  if (manifest.includes('{{')) {
    throw new Error('Scoop manifest template still contains unreplaced placeholders.');
  }

  JSON.parse(manifest);
  return manifest.endsWith('\n') ? manifest : `${manifest}\n`;
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
  console.log(`Usage: bun run scripts/generate-scoop-manifest.ts --version v1.2.3 --shasums dist-bin/SHASUMS256.txt [--output bucket/laurel.json]

Generates a Scoop bucket manifest from the checked-in template and Windows release checksum.
Use --stdout instead of --output to print the manifest.`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const [templateText, shasumsText] = await Promise.all([
    readFile(options.template, 'utf8'),
    readFile(options.shasums as string, 'utf8'),
  ]);
  const manifest = generateScoopManifest({
    version: options.version as string,
    shasumsText,
    templateText,
  });

  if (options.stdout) {
    process.stdout.write(manifest);
    return;
  }

  const output = options.output as string;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, manifest, 'utf8');
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
