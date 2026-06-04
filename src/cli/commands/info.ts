import { existsSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig } from '~/config/loader.ts';
import { loadContent } from '~/content/loader.ts';
import { loadTheme } from '~/theme/loader.ts';
import { getLaurelVersion } from '~/util/laurel-version.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { INFO_SPEC } from '../specs.ts';

interface InfoReport {
  laurel: { version: string };
  runtime: { bun: string | null; node: string };
  os: { platform: string; release: string; arch: string };
  project: {
    cwd: string;
    config_path: string | null;
    config_loaded: boolean;
    config_error?: string;
    site_title: string | null;
    site_url: string | null;
    locale: string | null;
    base_path: string | null;
    output_dir: string | null;
  };
  theme: { name: string | null; version: string | null; templates: number | null };
  content: {
    posts: number | null;
    pages: number | null;
    tags: number | null;
    authors: number | null;
  };
  env: Record<string, string>;
}

const TRACKED_ENV = [
  'LAUREL_QUIET',
  'LAUREL_VERBOSE',
  'LAUREL_BUILD_INCLUDE_DRAFTS',
  'LAUREL_DRAFTS',
  'LAUREL_SERVE_PORT',
  'LAUREL_SERVE_HOST',
  'EDITOR',
  'VISUAL',
  'NO_COLOR',
  'CI',
];

export async function runInfo(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(INFO_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(INFO_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(INFO_SPEC));
    return 0;
  }

  const asJson = parsed.values.json === true;
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  const cwd = process.cwd();

  const report = await collectReport({ cwd, configPath });
  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderText(report));
  }
  return 0;
}

interface CollectOptions {
  cwd: string;
  configPath: string | undefined;
}

async function collectReport(opts: CollectOptions): Promise<InfoReport> {
  const version = await getLaurelVersion();
  const bunVersion = typeof Bun !== 'undefined' ? Bun.version : null;

  const env: Record<string, string> = {};
  for (const key of TRACKED_ENV) {
    const v = process.env[key];
    if (v !== undefined && v !== '') env[key] = v;
  }

  const report: InfoReport = {
    laurel: { version },
    runtime: { bun: bunVersion, node: process.version },
    os: { platform: platform(), release: release(), arch: arch() },
    project: {
      cwd: opts.cwd,
      config_path: null,
      config_loaded: false,
      site_title: null,
      site_url: null,
      locale: null,
      base_path: null,
      output_dir: null,
    },
    theme: { name: null, version: null, templates: null },
    content: { posts: null, pages: null, tags: null, authors: null },
    env,
  };

  const candidateConfig = opts.configPath
    ? resolve(opts.cwd, opts.configPath)
    : findFirstExisting([join(opts.cwd, 'laurel.toml'), join(opts.cwd, 'laurel.config.toml')]);
  if (candidateConfig) report.project.config_path = candidateConfig;

  try {
    const config = await loadConfig({ cwd: opts.cwd, configPath: opts.configPath });
    report.project.config_loaded = true;
    report.project.site_title = config.site.title;
    report.project.site_url = config.site.url;
    report.project.locale = config.site.locale;
    report.project.base_path = config.build.base_path;
    report.project.output_dir = config.build.output_dir;

    try {
      const theme = await loadTheme({ cwd: opts.cwd, config });
      report.theme.name = theme.name;
      report.theme.version = theme.pkg.version ?? null;
      report.theme.templates = Object.keys(theme.templates).length;
    } catch {
      // theme missing is reported via doctor; surface nulls here.
    }

    try {
      const graph = await loadContent({ cwd: opts.cwd, config });
      report.content.posts = graph.posts.length;
      report.content.pages = graph.pages.length;
      report.content.tags = graph.tags.length;
      report.content.authors = graph.authors.length;
    } catch {
      // content errors are surfaced by `laurel check`; leave nulls.
    }
  } catch (err) {
    report.project.config_error = err instanceof Error ? err.message : String(err);
  }

  return report;
}

function findFirstExisting(paths: string[]): string | null {
  for (const p of paths) if (existsSync(p)) return p;
  return null;
}

function renderText(r: InfoReport): string {
  const lines: string[] = [];
  lines.push(`Laurel    ${r.laurel.version}`);
  lines.push(`Bun       ${r.runtime.bun ?? '(not detected)'}`);
  lines.push(`Node      ${r.runtime.node}`);
  lines.push(`OS        ${r.os.platform} ${r.os.release} (${r.os.arch})`);
  lines.push('');
  lines.push(`Project   ${r.project.cwd}`);
  lines.push(`  config:     ${r.project.config_path ?? '(none)'}`);
  if (r.project.config_loaded) {
    lines.push(`  site:       ${r.project.site_title}`);
    lines.push(`  url:        ${r.project.site_url}`);
    lines.push(`  locale:     ${r.project.locale}`);
    lines.push(`  base_path:  ${r.project.base_path}`);
    lines.push(`  output:     ${r.project.output_dir}`);
  } else if (r.project.config_error) {
    lines.push(`  (config failed to load: ${r.project.config_error})`);
  }
  lines.push('');
  lines.push(
    `Theme     ${r.theme.name ?? '(none)'}${r.theme.version ? ` ${r.theme.version}` : ''}`,
  );
  if (r.theme.templates !== null) lines.push(`  templates: ${r.theme.templates}`);
  lines.push('');
  lines.push('Content');
  lines.push(`  posts:   ${r.content.posts ?? '(unavailable)'}`);
  lines.push(`  pages:   ${r.content.pages ?? '(unavailable)'}`);
  lines.push(`  tags:    ${r.content.tags ?? '(unavailable)'}`);
  lines.push(`  authors: ${r.content.authors ?? '(unavailable)'}`);
  if (Object.keys(r.env).length > 0) {
    lines.push('');
    lines.push('Env');
    for (const [k, v] of Object.entries(r.env)) {
      lines.push(`  ${k}=${v}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
