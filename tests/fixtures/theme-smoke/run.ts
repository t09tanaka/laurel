#!/usr/bin/env bun
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '~/build/pipeline.ts';

export interface SmokeOptions {
  themeName: string;
  themePath: string;
  keepWorkDir?: boolean;
  log?: (message: string) => void;
}

export interface SmokeResult {
  workDir: string;
  routeCount: number;
  assetCount: number;
}

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));
const SITE_FIXTURE = join(FIXTURE_DIR, 'site');

export async function runSmoke(options: SmokeOptions): Promise<SmokeResult> {
  const log = options.log ?? defaultLog;
  const themeRoot = resolve(options.themePath);
  const workDir = await mkdtemp(join(tmpdir(), `laurel-smoke-${options.themeName}-`));
  log(`[smoke:${options.themeName}] workdir ${workDir}`);

  try {
    await cp(SITE_FIXTURE, workDir, { recursive: true });
    await mkdir(join(workDir, 'themes'), { recursive: true });
    await cp(themeRoot, join(workDir, 'themes', options.themeName), { recursive: true });
    await writeFile(join(workDir, 'laurel.toml'), renderLaurelToml(options.themeName), 'utf8');

    const summary = await build({ cwd: workDir });
    log(
      `[smoke:${options.themeName}] ok routes=${summary.routeCount} assets=${summary.assetCount}`,
    );
    return {
      workDir,
      routeCount: summary.routeCount,
      assetCount: summary.assetCount,
    };
  } finally {
    if (!options.keepWorkDir) {
      await rm(workDir, { recursive: true, force: true });
    } else {
      log(`[smoke:${options.themeName}] keeping ${workDir}`);
    }
  }
}

function defaultLog(message: string): void {
  process.stderr.write(`${message}\n`);
}

function renderLaurelToml(themeName: string): string {
  return [
    '[site]',
    'title = "Theme Smoke Fixture"',
    'description = "Minimal fixture used to smoke-test Ghost themes against Laurel"',
    'url = "https://smoke.example.com"',
    'locale = "en"',
    'timezone = "UTC"',
    'accent_color = "#222222"',
    'logo = "/content/images/cover.svg"',
    'icon = "/content/images/cover.svg"',
    '',
    '[theme]',
    `name = "${themeName}"`,
    'dir = "themes"',
    '',
    '[content]',
    'posts_dir = "content/posts"',
    'pages_dir = "content/pages"',
    'authors_dir = "content/authors"',
    'tags_dir = "content/tags"',
    'assets_dir = "content/images"',
    '',
    '[build]',
    'output_dir = "dist"',
    'base_path = "/"',
    'posts_per_page = 5',
    'copy_content_assets = true',
    '',
    '[[navigation]]',
    'label = "Home"',
    'url = "/"',
    '',
    '[[navigation]]',
    'label = "About"',
    'url = "/about/"',
    '',
    '[[navigation]]',
    'label = "Tag"',
    'url = "/tag/general/"',
    '',
    '[components.rss]',
    'enabled = true',
    '',
    '[components.sitemap]',
    'enabled = true',
    '',
    '[components.opengraph]',
    'enabled = true',
    '',
  ].join('\n');
}

interface CliArgs {
  themeName: string;
  themePath: string;
  keepWorkDir: boolean;
}

function parseCli(argv: string[]): CliArgs {
  let themeName: string | undefined;
  let themePath: string | undefined;
  let keepWorkDir = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--theme-name') {
      themeName = argv[++i];
    } else if (arg === '--theme-path') {
      themePath = argv[++i];
    } else if (arg === '--keep') {
      keepWorkDir = true;
    } else {
      throw new Error(`Unknown argument: ${arg ?? '<empty>'}`);
    }
  }
  if (!themeName || !themePath) {
    throw new Error(
      'Usage: bun tests/fixtures/theme-smoke/run.ts --theme-name <name> --theme-path <path> [--keep]',
    );
  }
  return { themeName, themePath, keepWorkDir };
}

if (import.meta.main) {
  try {
    const args = parseCli(process.argv.slice(2));
    await runSmoke({
      themeName: args.themeName,
      themePath: args.themePath,
      keepWorkDir: args.keepWorkDir,
    });
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
