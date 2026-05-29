import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { changedPathsAbsPath, loadBuildManifest } from '~/build/build-manifest.ts';
import { build } from '~/build/pipeline.ts';
import { loadConfig } from '~/config/loader.ts';
import type { NectarConfig } from '~/config/schema.ts';
import { EXIT_CODES, exitCodeForError } from '~/util/errors.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { DEPLOY_SPEC } from '../specs.ts';

type DeployTarget = 'cloudflare' | 'netlify' | 'vercel' | 'github-pages' | 's3' | 'r2' | 'rsync';

const DEPLOY_TARGETS: readonly DeployTarget[] = [
  'cloudflare',
  'netlify',
  'vercel',
  'github-pages',
  's3',
  'r2',
  'rsync',
];

// Maximum file count Cloudflare Pages will accept on a single deployment.
// Surfacing this as a build-time warning lets operators redirect oversized
// trees to R2 / image proxies (see docs/deploy/cloudflare-pages-r2-images.md)
// before the deploy itself fails with an opaque platform error.
const CLOUDFLARE_PAGES_FILE_LIMIT = 25_000;

/**
 * Detect the deploy target from common CI / hosting env vars. Returns
 * undefined when no signal is found so the caller can surface a usage hint
 * rather than guessing. The detection order matches "most specific wins":
 *
 * - `NETLIFY=true` (set in every Netlify build) -> netlify
 * - `VERCEL=1` -> vercel
 * - `CF_PAGES=1` (Cloudflare Pages build env) -> cloudflare
 * - `GITHUB_ACTIONS=true` + any `GITHUB_PAGES_*` signal -> github-pages
 *
 * Plain `GITHUB_ACTIONS=true` is intentionally not enough: GitHub Actions
 * runs anywhere, only Pages-targeted workflows ship to gh-pages.
 */
export function detectDeployTargetFromEnv(
  env: Record<string, string | undefined>,
): DeployTarget | undefined {
  if (truthyEnv(env.NETLIFY)) return 'netlify';
  if (truthyEnv(env.VERCEL)) return 'vercel';
  if (truthyEnv(env.CF_PAGES)) return 'cloudflare';
  if (truthyEnv(env.GITHUB_ACTIONS)) {
    for (const key of Object.keys(env)) {
      if (key.startsWith('GITHUB_PAGES_') && env[key] !== undefined && env[key] !== '') {
        return 'github-pages';
      }
    }
  }
  return undefined;
}

function truthyEnv(v: string | undefined): boolean {
  if (v === undefined) return false;
  const lower = v.toLowerCase();
  return lower === '1' || lower === 'true' || lower === 'yes';
}

/**
 * Walk the argv looking for the first positional argument. When it is
 * missing or the literal `auto`, attempt to detect the deploy target from
 * env and rewrite the args list to inject the detected target so the rest
 * of the CLI plumbing sees a normal `deploy <target> [...]` invocation.
 *
 * Returns the rewritten args, or an exit code when detection fails so the
 * caller can `return` it directly.
 */
function resolveAutoTargetInArgs(
  args: string[],
  env: Record<string, string | undefined>,
): string[] | number {
  // Help / version short-circuit: leave the original args alone so the
  // standard parser path handles `--help` / `-h` formatting.
  if (args.includes('--help') || args.includes('-h')) return args;
  if (readTargetFlagValue(args) !== undefined) return args;

  let positionalIdx = -1;
  let positionalValue: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (tok === undefined) continue;
    if (tok === '--') break;
    if (tok.startsWith('-')) {
      // Skip an attached value when the flag uses `--key value` form rather
      // than `--key=value`. Only string-typed flags carry a separate value;
      // boolean flags do not. We approximate by skipping the next token only
      // when it does not itself look like a flag, which matches every value
      // shape the deploy spec accepts (`--project-name foo`, `--config x`).
      if (!tok.includes('=') && i + 1 < args.length) {
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith('-')) i += 1;
      }
      continue;
    }
    positionalIdx = i;
    positionalValue = tok;
    break;
  }

  const needsAuto = positionalValue === undefined || positionalValue === 'auto';
  if (!needsAuto) return args;

  const detected = detectDeployTargetFromEnv(env);
  if (detected === undefined) {
    process.stderr.write(
      positionalValue === 'auto'
        ? 'Could not auto-detect deploy target from environment.\n'
        : 'Missing required argument: <target>\n',
    );
    process.stderr.write(
      'Hint: set NETLIFY=1, VERCEL=1, CF_PAGES=1, or GITHUB_ACTIONS=true + GITHUB_PAGES_*, or pass an explicit target.\n\n',
    );
    process.stderr.write(formatCommandHelp(DEPLOY_SPEC));
    return EXIT_CODES.usage;
  }
  logger.info(`Auto-detected deploy target: ${detected}`);
  if (positionalValue === undefined) {
    return [...args, detected];
  }
  // Replace the 'auto' positional in place so flag order is preserved.
  const next = args.slice();
  next[positionalIdx] = detected;
  return next;
}

function readTargetFlagValue(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (tok === undefined) continue;
    if (tok === '--') break;
    if (tok.startsWith('--target=')) return tok.slice('--target='.length);
    if (tok === '--target') {
      const next = args[i + 1];
      return next !== undefined && !next.startsWith('-') ? next : undefined;
    }
  }
  return undefined;
}

function countFilesRecursive(dir: string, max: number): number {
  let count = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === undefined) break;
    let entries: string[];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(cur, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else {
        count += 1;
        if (count > max) return count;
      }
    }
  }
  return count;
}

interface DeployFileSummary {
  path: string;
  size: number;
}

interface DeployDryRunSummary {
  files: DeployFileSummary[];
  changedPaths: string[] | undefined;
}

interface DeployPreflightPlan {
  command: string;
  args: string[];
  bucket: string;
}

interface DeployPlan {
  target: DeployTarget;
  // The external command + argv that would be spawned. For multi-step targets
  // (github-pages) this is the headline command; auxiliary git plumbing is
  // surfaced via `extra`.
  command: string;
  args: string[];
  // Optional follow-up commands (e.g. github-pages runs several git invocations).
  extra: Array<{ command: string; args: string[] }>;
  // Optional pre-deploy validation command. It is only executed when the user
  // explicitly passes --preflight so normal deploy behavior stays unchanged.
  preflight?: DeployPreflightPlan;
  // Follow-up commands that must run after the headline command. Kept separate
  // from `extra`, which is currently used by github-pages as a dry-run-only
  // explanation of its git plumbing.
  followUp?: Array<{ command: string; args: string[] }>;
  env: Record<string, string | undefined>;
  cwd: string;
  // What the operator should see in --dry-run output: a shell-quoted summary
  // so audit logs can be diffed.
  summary: string;
}

interface RunDeployOptions {
  /** Override `process.cwd()` (tests). */
  cwd?: string;
  /** Override `process.env` (tests). */
  env?: Record<string, string | undefined>;
}

export async function runDeploy(args: string[], options: RunDeployOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  // Peek at the first non-flag positional and, when it is missing or the
  // literal 'auto', swap in the detected target before delegating to
  // parseCommand. Flags can still appear before the positional.
  const effectiveArgs = resolveAutoTargetInArgs(args, env);
  if (typeof effectiveArgs === 'number') return effectiveArgs;

  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(DEPLOY_SPEC, effectiveArgs, env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(DEPLOY_SPEC));
      return EXIT_CODES.usage;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(DEPLOY_SPEC));
    return EXIT_CODES.ok;
  }

  const cwd = options.cwd ?? process.cwd();

  const targetRaw = parsed.positionals[0];
  const targetFromFlag = pickString(parsed.values.target);
  const targetValue = targetRaw ?? targetFromFlag;
  if (targetValue === undefined) {
    process.stderr.write('Missing required argument: <target>\n\n');
    process.stderr.write(formatCommandHelp(DEPLOY_SPEC));
    return EXIT_CODES.usage;
  }
  if (!isDeployTarget(targetValue)) {
    process.stderr.write(
      `Unknown deploy target: ${targetValue} (expected one of: auto, ${DEPLOY_TARGETS.join(', ')})\n\n`,
    );
    process.stderr.write(formatCommandHelp(DEPLOY_SPEC));
    return EXIT_CODES.usage;
  }
  const target: DeployTarget = targetValue;
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  const dryRun = parsed.values['dry-run'] === true;
  const runPreflight = parsed.values.preflight === true;
  const runBuildFirst = parsed.values.build === true;

  if (runPreflight && target !== 's3') {
    process.stderr.write('deploy --preflight is currently supported only for the s3 target.\n');
    return EXIT_CODES.usage;
  }

  let config: NectarConfig;
  try {
    config = await loadConfig({ cwd, configPath });
  } catch (err) {
    reportError(err, cwd);
    return exitCodeForError(err);
  }

  const outputDir = resolveOutputDir(cwd, config.build.output_dir);

  if (runBuildFirst) {
    try {
      const summary = await build({ cwd, configPath });
      logger.info(
        `Built ${summary.routeCount} routes (${summary.assetCount} assets) -> ${summary.outputDir}`,
      );
    } catch (err) {
      reportError(err, cwd);
      return exitCodeForError(err);
    }
  }

  if (!existsSync(outputDir)) {
    process.stderr.write(
      `dist/ does not exist at ${outputDir}. Run \`nectar build\` first or pass --build.\n`,
    );
    return EXIT_CODES.generic;
  }
  // The build pipeline writes `.nectar-manifest.json` only on successful runs.
  // Treating its absence as "no build present" prevents shipping a half-written
  // directory left over from a crashed build (or a hand-populated `dist/` that
  // bypassed nectar entirely).
  const manifestPath = join(outputDir, '.nectar-manifest.json');
  if (!existsSync(manifestPath)) {
    process.stderr.write(
      `No build manifest at ${manifestPath}. Run \`nectar build\` (or pass --build) before deploying.\n`,
    );
    return EXIT_CODES.generic;
  }

  // Cloudflare Pages caps deployments at 25,000 files. Surfaced as a warning
  // here (rather than a hard error) so the operator can still attempt the
  // deploy — wrangler will reject it with a clearer remediation than a CLI
  // refusal — but with a heads-up that points at the R2-as-image-origin
  // recipe in docs/deploy/cloudflare-pages-r2-images.md.
  if (target === 'cloudflare') {
    const fileCount = countFilesRecursive(outputDir, CLOUDFLARE_PAGES_FILE_LIMIT);
    if (fileCount > CLOUDFLARE_PAGES_FILE_LIMIT) {
      logger.warn(
        `Cloudflare Pages allows at most ${CLOUDFLARE_PAGES_FILE_LIMIT} files per deployment; ${outputDir} contains more than that. Move generated image variants to R2 or another origin (see docs/deploy/cloudflare-pages-r2-images.md) before deploying.`,
      );
    }
  }

  let plan: DeployPlan;
  try {
    plan = planDeploy({
      target,
      cwd,
      env,
      outputDir,
      config,
      cliValues: parsed.values,
    });
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n`);
      return EXIT_CODES.usage;
    }
    throw err;
  }

  if (dryRun) {
    const deploySummary = await collectDeployDryRunSummary(outputDir);
    process.stdout.write(formatDeployDryRun(plan, deploySummary, runPreflight));
    return EXIT_CODES.ok;
  }

  if (runPreflight) {
    const preflightCode = await executePreflight(plan);
    if (preflightCode !== EXIT_CODES.ok) return preflightCode;
  }

  return await executePlan(plan);
}

async function collectDeployDryRunSummary(outputDir: string): Promise<DeployDryRunSummary> {
  const buildManifest = await loadBuildManifest(outputDir);
  const files =
    buildManifest?.files.map((file) => ({ path: file.path, size: file.size })) ??
    listFilesRecursive(outputDir);
  return {
    files: files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    changedPaths: readChangedPaths(outputDir),
  };
}

function listFilesRecursive(dir: string): DeployFileSummary[] {
  const files: DeployFileSummary[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === undefined) break;
    let entries: string[];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(cur, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
        continue;
      }
      files.push({ path: toPosix(relative(dir, full)), size: st.size });
    }
  }
  return files;
}

function readChangedPaths(outputDir: string): string[] | undefined {
  const path = changedPathsAbsPath(outputDir);
  if (!existsSync(path)) return undefined;
  const body = readFileSync(path, 'utf8');
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function formatDeployDryRun(
  plan: DeployPlan,
  summary: DeployDryRunSummary,
  includePreflight = false,
): string {
  const lines: string[] = [
    plan.summary,
    '',
    ...(includePreflight && plan.preflight
      ? [`Preflight check: ${shellQuote([plan.preflight.command, ...plan.preflight.args])}`, '']
      : []),
    `Files to deploy for ${plan.target} (${summary.files.length}):`,
  ];
  if (summary.files.length === 0) {
    lines.push('  (none)');
  } else {
    for (const file of summary.files) {
      lines.push(`  ${file.path} (${formatBytes(file.size)})`);
    }
  }
  lines.push('', 'Diff against last build:');
  if (summary.changedPaths === undefined) {
    lines.push('  (unavailable: no .nectar/changed-paths.txt)');
  } else if (summary.changedPaths.length === 0) {
    lines.push('  (no changed paths)');
  } else {
    lines.push(`Changed since previous build (${summary.changedPaths.length}):`);
    for (const path of summary.changedPaths) lines.push(`  ${path}`);
  }
  return `${lines.join('\n')}\n`;
}

function formatBytes(bytes: number): string {
  return `${bytes} B`;
}

interface PlanDeployArgs {
  target: DeployTarget;
  cwd: string;
  env: Record<string, string | undefined>;
  outputDir: string;
  config: NectarConfig;
  cliValues: Record<string, string | boolean | undefined>;
}

export function planDeploy(args: PlanDeployArgs): DeployPlan {
  switch (args.target) {
    case 'cloudflare':
      return planCloudflare(args);
    case 'netlify':
      return planNetlify(args);
    case 'vercel':
      return planVercel(args);
    case 'github-pages':
      return planGithubPages(args);
    case 's3':
      return planS3(args);
    case 'r2':
      return planR2(args);
    case 'rsync':
      return planRsync(args);
  }
}

function planCloudflare(args: PlanDeployArgs): DeployPlan {
  const cfg = args.config.deploy.cloudflare;
  const projectName = pickString(args.cliValues['project-name']) ?? cfg.project_name;
  if (!projectName) {
    throw new CliUsageError(
      'cloudflare deploy requires a project name. Set [deploy.cloudflare].project_name in nectar.toml or pass --project-name.',
    );
  }
  const branch = pickString(args.cliValues.branch) ?? cfg.branch;
  const argv = ['pages', 'deploy', args.outputDir, `--project-name=${projectName}`];
  if (branch) argv.push(`--branch=${branch}`);
  if (!args.env.CLOUDFLARE_API_TOKEN && !args.env.CF_API_TOKEN) {
    logger.warn(
      'CLOUDFLARE_API_TOKEN is not set; wrangler will fall back to interactive login. Set the env var in CI.',
    );
  }
  return {
    target: 'cloudflare',
    command: 'wrangler',
    args: argv,
    extra: [],
    env: args.env,
    cwd: args.cwd,
    summary: shellQuote(['wrangler', ...argv]),
  };
}

function planNetlify(args: PlanDeployArgs): DeployPlan {
  const cfg = args.config.deploy.netlify;
  const siteId = pickString(args.cliValues['site-id']) ?? cfg.site_id;
  // --prod is treated as a tri-state: explicit CLI override wins, otherwise
  // fall back to the config default (true). The CLI surface only has a boolean
  // flag for opt-in `--prod`; opt-out is via env var or [deploy.netlify].prod.
  const prodOverride = args.cliValues.prod === true ? true : undefined;
  const prod = prodOverride ?? cfg.prod;
  const argv = ['deploy', '--dir', args.outputDir];
  if (prod) argv.push('--prod');
  if (siteId) argv.push('--site', siteId);
  if (!args.env.NETLIFY_AUTH_TOKEN) {
    logger.warn(
      'NETLIFY_AUTH_TOKEN is not set; netlify will fall back to interactive login. Set the env var in CI.',
    );
  }
  return {
    target: 'netlify',
    command: 'netlify',
    args: argv,
    extra: [],
    env: args.env,
    cwd: args.cwd,
    summary: shellQuote(['netlify', ...argv]),
  };
}

function planVercel(args: PlanDeployArgs): DeployPlan {
  const cfg = args.config.deploy.vercel;
  const project = pickString(args.cliValues['project-name']) ?? cfg.project;
  const prodOverride = args.cliValues.prod === true ? true : undefined;
  const prod = prodOverride ?? cfg.prod;
  const argv = ['deploy', args.outputDir];
  if (prod) argv.push('--prod');
  if (project) argv.push('--scope', project);
  if (!args.env.VERCEL_TOKEN) {
    logger.warn(
      'VERCEL_TOKEN is not set; vercel will fall back to interactive login. Set the env var in CI.',
    );
  }
  return {
    target: 'vercel',
    command: 'vercel',
    args: argv,
    extra: [],
    env: args.env,
    cwd: args.cwd,
    summary: shellQuote(['vercel', ...argv]),
  };
}

function planGithubPages(args: PlanDeployArgs): DeployPlan {
  const cfg = args.config.deploy.github_pages;
  const branch = pickString(args.cliValues.branch) ?? cfg.branch;
  const remote = pickString(args.cliValues.remote) ?? cfg.remote;
  // The headline command surfaced in --dry-run summarises the final push;
  // the underlying flow uses git plumbing (worktree add, commit, push) so
  // operators can audit each step. We expose `extra` so tests can assert on
  // the exact sequence without executing it.
  const headline = ['git', 'push', remote, `HEAD:${branch}`];
  const extra: Array<{ command: string; args: string[] }> = [
    { command: 'git', args: ['worktree', 'add', '.nectar-gh-pages', '--detach'] },
    { command: 'git', args: ['add', '--all'] },
    { command: 'git', args: ['commit', '--allow-empty', '-m', 'deploy: nectar build'] },
  ];
  return {
    target: 'github-pages',
    command: 'git',
    args: headline.slice(1),
    extra,
    env: args.env,
    cwd: args.cwd,
    summary: [shellQuote(headline), `  (publishes ${args.outputDir} to ${remote}:${branch})`].join(
      '\n',
    ),
  };
}

function planS3(args: PlanDeployArgs): DeployPlan {
  const cfg = args.config.deploy.s3;
  const bucket = pickString(args.cliValues.bucket) ?? cfg.bucket;
  if (!bucket) {
    throw new CliUsageError(
      's3 deploy requires a bucket. Set [deploy.s3].bucket in nectar.toml or pass --bucket.',
    );
  }
  const region = pickString(args.cliValues.region) ?? cfg.region;
  const destination = `s3://${bucket}`;
  const argv = [
    's3',
    'sync',
    args.outputDir,
    destination,
    '--exclude',
    '*.br',
    '--exclude',
    '*.gz',
  ];
  if (cfg.delete) argv.push('--delete');
  if (region) argv.push('--region', region);
  const encodedUploads = planS3EncodedSidecarUploads(
    args.outputDir,
    destination,
    region,
    cfg.delete,
  );
  if (!args.env.AWS_ACCESS_KEY_ID && !args.env.AWS_PROFILE) {
    logger.warn(
      'Neither AWS_ACCESS_KEY_ID nor AWS_PROFILE is set; aws will use its default credential chain (instance profile, shared config, etc.).',
    );
  }
  return {
    target: 's3',
    command: 'aws',
    args: argv,
    extra: [],
    preflight: planS3PublicAccessPreflight(bucket, region),
    followUp: encodedUploads,
    env: args.env,
    cwd: args.cwd,
    summary: [
      shellQuote(['aws', ...argv]),
      ...encodedUploads.map((cmd) => shellQuote(['aws', ...cmd.args])),
    ].join('\n'),
  };
}

function planS3PublicAccessPreflight(
  bucket: string,
  region: string | undefined,
): DeployPreflightPlan {
  const argv = ['s3api', 'get-bucket-policy-status', '--bucket', bucket, '--output', 'json'];
  if (region) argv.push('--region', region);
  return {
    command: 'aws',
    args: argv,
    bucket,
  };
}

function planR2(args: PlanDeployArgs): DeployPlan {
  const cfg = args.config.deploy.r2;
  const bucket = pickString(args.cliValues.bucket) ?? cfg.bucket;
  if (!bucket) {
    throw new CliUsageError(
      'r2 deploy requires a bucket. Set [deploy.r2].bucket in nectar.toml or pass --bucket.',
    );
  }
  const endpoint = pickString(args.cliValues.endpoint) ?? cfg.endpoint;
  if (!endpoint) {
    throw new CliUsageError(
      'r2 deploy requires an endpoint URL. Set [deploy.r2].endpoint in nectar.toml or pass --endpoint.',
    );
  }
  const argv = ['s3', 'sync', args.outputDir, `s3://${bucket}`, '--endpoint-url', endpoint];
  if (cfg.delete) argv.push('--delete');
  if (!args.env.AWS_ACCESS_KEY_ID) {
    logger.warn(
      'AWS_ACCESS_KEY_ID is not set; aws will use its default credential chain. Cloudflare R2 needs an R2-issued access key id/secret pair.',
    );
  }
  return {
    target: 'r2',
    command: 'aws',
    args: argv,
    extra: [],
    env: args.env,
    cwd: args.cwd,
    summary: shellQuote(['aws', ...argv]),
  };
}

function planRsync(args: PlanDeployArgs): DeployPlan {
  const cfg = args.config.deploy.rsync;
  const destination = pickString(args.cliValues.destination) ?? cfg.destination;
  if (!destination) {
    throw new CliUsageError(
      'rsync deploy requires a destination. Set [deploy.rsync].destination in nectar.toml or pass --destination.',
    );
  }
  // Append a trailing slash to the source so rsync copies the *contents* of
  // dist/ into the destination dir instead of nesting `dist/` underneath it.
  const source = args.outputDir.endsWith('/') ? args.outputDir : `${args.outputDir}/`;
  const argv = [...cfg.flags, source, destination];
  return {
    target: 'rsync',
    command: 'rsync',
    args: argv,
    extra: [],
    env: args.env,
    cwd: args.cwd,
    summary: shellQuote(['rsync', ...argv]),
  };
}

async function executePlan(plan: DeployPlan): Promise<number> {
  const commands = [{ command: plan.command, args: plan.args }, ...(plan.followUp ?? [])];
  for (const cmd of commands) {
    logger.info(`Deploying via ${cmd.command} ${cmd.args.join(' ')}`);
    const proc = Bun.spawn([cmd.command, ...cmd.args], {
      cwd: plan.cwd,
      env: filterDefinedEnv(plan.env),
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const code = await proc.exited;
    if (code !== 0) {
      process.stderr.write(`${cmd.command} exited with code ${code}\n`);
      return EXIT_CODES.generic;
    }
  }
  return EXIT_CODES.ok;
}

async function executePreflight(plan: DeployPlan): Promise<number> {
  if (!plan.preflight) return EXIT_CODES.ok;
  const preflight = plan.preflight;
  logger.info(`Running preflight via ${preflight.command} ${preflight.args.join(' ')}`);
  const proc = Bun.spawn([preflight.command, ...preflight.args], {
    cwd: plan.cwd,
    env: filterDefinedEnv(plan.env),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) {
    if (stderr.trim().length > 0)
      process.stderr.write(stderr.endsWith('\n') ? stderr : `${stderr}\n`);
    process.stderr.write(
      `${preflight.command} ${preflight.args.join(' ')} exited with code ${code}\n`,
    );
    return EXIT_CODES.generic;
  }

  const isPublic = parseS3BucketPolicyIsPublic(stdout);
  if (isPublic === undefined) {
    process.stderr.write(
      `${preflight.command} ${preflight.args.join(' ')} did not return PolicyStatus.IsPublic\n`,
    );
    return EXIT_CODES.generic;
  }
  if (isPublic) {
    logger.warn(
      `S3 bucket ${preflight.bucket} has a public bucket policy. For S3 + CloudFront, keep the bucket private and grant CloudFront access with Origin Access Control before deploying.`,
    );
  } else {
    logger.info(`S3 bucket ${preflight.bucket} bucket policy status is not public.`);
  }
  return EXIT_CODES.ok;
}

function parseS3BucketPolicyIsPublic(stdout: string): boolean | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object') return undefined;
  const policyStatus = (parsed as { PolicyStatus?: unknown }).PolicyStatus;
  if (policyStatus === null || typeof policyStatus !== 'object') return undefined;
  const isPublic = (policyStatus as { IsPublic?: unknown }).IsPublic;
  return typeof isPublic === 'boolean' ? isPublic : undefined;
}

function planS3EncodedSidecarUploads(
  outputDir: string,
  destination: string,
  region: string | undefined,
  deleteStale: boolean,
): Array<{ command: string; args: string[] }> {
  const files = listFilesRecursive(outputDir)
    .map((file) => file.path)
    .filter((path) => path.endsWith('.br') || path.endsWith('.gz'))
    .sort();
  const commands: Array<{ command: string; args: string[] }> = [];
  if (deleteStale) {
    const args = [
      's3',
      'rm',
      destination,
      '--recursive',
      '--exclude',
      '*',
      '--include',
      '*.br',
      '--include',
      '*.gz',
    ];
    if (region) args.push('--region', region);
    commands.push({ command: 'aws', args });
  }
  commands.push(
    ...files.map((path) => {
      const encoding = path.endsWith('.br') ? 'br' : 'gzip';
      const source = join(outputDir, path);
      const args = ['s3', 'cp', source, `${destination}/${path}`, '--content-encoding', encoding];
      const contentType = contentTypeForPrecompressedSource(path);
      if (contentType !== undefined) args.push('--content-type', contentType);
      if (region) args.push('--region', region);
      return { command: 'aws', args };
    }),
  );
  return commands;
}

function contentTypeForPrecompressedSource(path: string): string | undefined {
  const sourcePath = path.slice(0, -3);
  switch (extname(sourcePath).toLowerCase()) {
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.json':
    case '.map':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.xml':
      return 'application/xml; charset=utf-8';
    case '.txt':
      return 'text/plain; charset=utf-8';
    default:
      return undefined;
  }
}

function pickString(v: string | boolean | undefined): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function isDeployTarget(s: string): s is DeployTarget {
  return (DEPLOY_TARGETS as readonly string[]).includes(s);
}

function resolveOutputDir(cwd: string, outputDir: string): string {
  return isAbsolute(outputDir) ? outputDir : resolve(cwd, outputDir);
}

function filterDefinedEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// Minimal POSIX-shell-safe quoting for human-readable --dry-run summaries.
// Wraps anything with whitespace or shell metacharacters in single quotes and
// escapes embedded single quotes the standard `'\''` way. Not used to build
// real command invocations (Bun.spawn takes an argv array, no shell), only for
// the printable summary line.
export function shellQuote(argv: readonly string[]): string {
  return argv.map(quoteArg).join(' ');
}

function quoteArg(arg: string): string {
  if (arg.length === 0) return "''";
  if (/^[A-Za-z0-9_\-+=:,.\/@%]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}
