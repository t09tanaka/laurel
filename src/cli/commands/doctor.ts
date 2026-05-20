import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RSS_MAX_ITEMS_PER_PAGE } from '~/build/feeds.ts';
import { loadConfig } from '~/config/loader.ts';
import type { NectarConfig } from '~/config/schema.ts';
import { parseFrontmatter } from '~/content/frontmatter.ts';
import { loadTheme } from '~/theme/loader.ts';
import { scanGlob } from '~/util/fs.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { DOCTOR_SPEC } from '../specs.ts';

type CheckStatus = 'PASS' | 'WARN' | 'FAIL';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  fix?: string;
}

const ORPHAN_DRAFT_DAYS = 90;
const NETWORK_TIMEOUT_MS = 3000;
const NETWORK_PROBE_URL = 'https://registry.npmjs.org/-/ping?write=true';

export async function runDoctor(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(DOCTOR_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(DOCTOR_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(DOCTOR_SPEC));
    return 0;
  }

  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  const asJson = parsed.values.json === true;
  const skipNetwork = parsed.values.network === false;
  const cwd = process.cwd();

  const results = await runChecks({ cwd, configPath, skipNetwork });

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
  } else {
    process.stdout.write(renderTable(results));
  }

  return results.some((r) => r.status === 'FAIL') ? 1 : 0;
}

interface RunOptions {
  cwd: string;
  configPath?: string | undefined;
  skipNetwork: boolean;
}

export async function runChecks(opts: RunOptions): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  results.push(await checkBunVersion(opts.cwd));
  results.push(checkEditor());

  let config: NectarConfig | undefined;
  const configResult = await checkConfig(opts.cwd, opts.configPath);
  results.push(configResult.result);
  config = configResult.config;

  if (config) {
    results.push(await checkTheme(opts.cwd, config));
    results.push(checkContentDirs(opts.cwd, config));
    results.push(await checkOrphanedDrafts(opts.cwd, config));
    results.push(checkRssSitemap(config));
  }

  if (opts.skipNetwork) {
    results.push({
      name: 'network',
      status: 'PASS',
      message: 'skipped (--no-network)',
    });
  } else {
    results.push(await checkNetwork());
  }

  return results;
}

async function checkBunVersion(cwd: string): Promise<CheckResult> {
  const required = await readEnginesBun(cwd);
  const current = typeof Bun !== 'undefined' ? Bun.version : undefined;

  if (!current) {
    return {
      name: 'bun-version',
      status: 'FAIL',
      message: 'Bun runtime not detected (running under Node?)',
      fix: 'Install Bun (https://bun.sh) and run `nectar` via Bun.',
    };
  }
  if (!required) {
    return {
      name: 'bun-version',
      status: 'PASS',
      message: `Bun ${current} (no engines.bun constraint declared)`,
    };
  }
  if (!satisfiesMinVersion(current, required)) {
    return {
      name: 'bun-version',
      status: 'FAIL',
      message: `Bun ${current} does not satisfy ${required}`,
      fix: `Upgrade Bun: \`bun upgrade\` (need ${required}).`,
    };
  }
  return {
    name: 'bun-version',
    status: 'PASS',
    message: `Bun ${current} satisfies ${required}`,
  };
}

function checkEditor(): CheckResult {
  const editor = process.env.EDITOR ?? process.env.VISUAL;
  if (!editor) {
    return {
      name: 'editor-env',
      status: 'WARN',
      message: '$EDITOR is not set',
      fix: 'Set $EDITOR (e.g. `export EDITOR=vi`) so editor-driven commands can open files.',
    };
  }
  return {
    name: 'editor-env',
    status: 'PASS',
    message: `$EDITOR=${editor}`,
  };
}

async function checkConfig(
  cwd: string,
  configPath: string | undefined,
): Promise<{ result: CheckResult; config?: NectarConfig }> {
  try {
    const config = await loadConfig({ cwd, configPath });
    return {
      result: {
        name: 'config-valid',
        status: 'PASS',
        message: `config OK (site: ${config.site.title})`,
      },
      config,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      result: {
        name: 'config-valid',
        status: 'FAIL',
        message: `config schema invalid: ${msg}`,
        fix: 'Edit nectar.toml to match the schema (see docs/DESIGN.md or `nectar check`).',
      },
    };
  }
}

async function checkTheme(cwd: string, config: NectarConfig): Promise<CheckResult> {
  try {
    const theme = await loadTheme({ cwd, config });
    return {
      name: 'theme-present',
      status: 'PASS',
      message: `theme "${theme.name}" loaded (${Object.keys(theme.templates).length} templates)`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: 'theme-present',
      status: 'FAIL',
      message: `theme load failed: ${msg}`,
      fix: `Place a theme at \`${config.theme.dir}/${config.theme.name}\` or update [theme] in nectar.toml.`,
    };
  }
}

function checkContentDirs(cwd: string, config: NectarConfig): CheckResult {
  const dirs = [
    { key: 'posts_dir', path: config.content.posts_dir },
    { key: 'pages_dir', path: config.content.pages_dir },
    { key: 'authors_dir', path: config.content.authors_dir },
  ];
  const missing = dirs.filter((d) => !existsSync(join(cwd, d.path)));
  if (missing.length === 0) {
    return {
      name: 'content-dirs',
      status: 'PASS',
      message: 'all configured content directories exist',
    };
  }
  return {
    name: 'content-dirs',
    status: 'WARN',
    message: `missing: ${missing.map((m) => m.path).join(', ')}`,
    fix: `Create the directories: ${missing.map((m) => `mkdir -p ${m.path}`).join('; ')}`,
  };
}

async function checkOrphanedDrafts(cwd: string, config: NectarConfig): Promise<CheckResult> {
  const dirs = [config.content.posts_dir, config.content.pages_dir];
  const cutoff = Date.now() - ORPHAN_DRAFT_DAYS * 24 * 60 * 60 * 1000;
  const orphans: string[] = [];

  for (const dir of dirs) {
    const absDir = join(cwd, dir);
    if (!existsSync(absDir)) continue;
    const rels = await scanGlob('**/*.md', { cwd: absDir });
    const raws = await Promise.all(
      rels.map(async (rel) => {
        try {
          return await readFile(join(absDir, rel), 'utf8');
        } catch {
          return null;
        }
      }),
    );
    for (let i = 0; i < rels.length; i += 1) {
      const rel = rels[i];
      const raw = raws[i];
      if (rel === undefined || raw === null || raw === undefined) continue;
      const file = join(absDir, rel);
      let data: Record<string, unknown>;
      try {
        ({ data } = parseFrontmatter(raw, { filePath: file }));
      } catch {
        continue;
      }
      if (data.status !== 'draft') continue;
      const ts = pickTimestamp(data);
      if (ts === undefined || ts < cutoff) {
        orphans.push(rel);
      }
    }
  }

  if (orphans.length === 0) {
    return {
      name: 'orphaned-drafts',
      status: 'PASS',
      message: `no drafts older than ${ORPHAN_DRAFT_DAYS} days`,
    };
  }
  const preview = orphans.slice(0, 3).join(', ');
  const suffix = orphans.length > 3 ? ` (+${orphans.length - 3} more)` : '';
  return {
    name: 'orphaned-drafts',
    status: 'WARN',
    message: `${orphans.length} stale draft(s): ${preview}${suffix}`,
    fix: 'Publish (set status: published), update the date, or delete the draft.',
  };
}

function pickTimestamp(data: Record<string, unknown>): number | undefined {
  const candidates = [data.updated_at, data.date, data.published_at, data.created_at];
  for (const c of candidates) {
    if (typeof c === 'string') {
      const ms = Date.parse(c);
      if (!Number.isNaN(ms)) return ms;
    } else if (c instanceof Date) {
      const ms = c.getTime();
      if (!Number.isNaN(ms)) return ms;
    }
  }
  return undefined;
}

function checkRssSitemap(config: NectarConfig): CheckResult {
  const issues: string[] = [];
  if (config.components.rss.enabled && config.components.rss.items <= 0) {
    issues.push('components.rss.items must be > 0 when rss is enabled');
  }
  if (config.components.rss.enabled && config.components.rss.items > RSS_MAX_ITEMS_PER_PAGE) {
    issues.push(
      `components.rss.items=${config.components.rss.items} exceeds the per-page cap of ${RSS_MAX_ITEMS_PER_PAGE}; overflow posts will paginate into rss-N.xml`,
    );
  }
  if (issues.length === 0) {
    return {
      name: 'rss-sitemap-config',
      status: 'PASS',
      message: `rss ${config.components.rss.enabled ? 'on' : 'off'}, sitemap ${
        config.components.sitemap.enabled ? 'on' : 'off'
      }`,
    };
  }
  return {
    name: 'rss-sitemap-config',
    status: 'WARN',
    message: issues.join('; '),
    fix: 'Adjust [components.rss] / [components.sitemap] in nectar.toml.',
  };
}

async function checkNetwork(): Promise<CheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const res = await fetch(NETWORK_PROBE_URL, {
      method: 'HEAD',
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        name: 'network',
        status: 'WARN',
        message: `probe returned HTTP ${res.status}`,
        fix: 'Check connectivity if you rely on `nectar version --check` or remote assets.',
      };
    }
    return {
      name: 'network',
      status: 'PASS',
      message: `reachable (${NETWORK_PROBE_URL})`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: 'network',
      status: 'WARN',
      message: `unreachable: ${msg}`,
      fix: 'Confirm internet access or pass --no-network in offline environments.',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readEnginesBun(cwd: string): Promise<string | undefined> {
  const candidates = [
    join(cwd, 'package.json'),
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../package.json'),
  ];
  for (const path of candidates) {
    const absolute = isAbsolute(path) ? path : resolve(cwd, path);
    try {
      const raw = await readFile(absolute, 'utf8');
      const json = JSON.parse(raw) as { engines?: { bun?: string } };
      if (json.engines?.bun) return json.engines.bun;
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

export function satisfiesMinVersion(current: string, constraint: string): boolean {
  const minMatch = constraint.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!minMatch) return true;
  const need: [number, number, number] = [
    Number(minMatch[1]),
    Number(minMatch[2]),
    Number(minMatch[3]),
  ];
  const cur = current.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!cur) return false;
  const have: [number, number, number] = [Number(cur[1]), Number(cur[2]), Number(cur[3])];
  for (let i = 0; i < 3; i += 1) {
    const a = have[i] as number;
    const b = need[i] as number;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

function renderTable(results: CheckResult[]): string {
  const nameWidth = Math.max(...results.map((r) => r.name.length), 4);
  const lines: string[] = [];
  lines.push(`${pad('check', nameWidth)}  status  detail`);
  lines.push(`${'-'.repeat(nameWidth)}  ------  ------`);
  for (const r of results) {
    lines.push(`${pad(r.name, nameWidth)}  ${pad(r.status, 6)}  ${r.message}`);
    if (r.fix && r.status !== 'PASS') {
      lines.push(`${' '.repeat(nameWidth)}          how to fix: ${r.fix}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function pad(text: string, width: number): string {
  if (text.length >= width) return text;
  return text + ' '.repeat(width - text.length);
}
