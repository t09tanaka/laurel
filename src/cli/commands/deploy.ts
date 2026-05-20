import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { build } from '~/build/pipeline.ts';
import { loadConfig } from '~/config/loader.ts';
import type { NectarConfig } from '~/config/schema.ts';
import { EXIT_CODES, exitCodeForError } from '~/util/errors.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { DEPLOY_SPEC } from '../specs.ts';

export type DeployTarget =
  | 'cloudflare'
  | 'netlify'
  | 'vercel'
  | 'github-pages'
  | 's3'
  | 'r2'
  | 'rsync';

const DEPLOY_TARGETS: readonly DeployTarget[] = [
  'cloudflare',
  'netlify',
  'vercel',
  'github-pages',
  's3',
  'r2',
  'rsync',
];

export interface DeployPlan {
  target: DeployTarget;
  // The external command + argv that would be spawned. For multi-step targets
  // (github-pages) this is the headline command; auxiliary git plumbing is
  // surfaced via `extra`.
  command: string;
  args: string[];
  // Optional follow-up commands (e.g. github-pages runs several git invocations).
  extra: Array<{ command: string; args: string[] }>;
  env: Record<string, string | undefined>;
  cwd: string;
  // What the operator should see in --dry-run output: a shell-quoted summary
  // so audit logs can be diffed.
  summary: string;
}

export interface RunDeployOptions {
  /** Override `process.cwd()` (tests). */
  cwd?: string;
  /** Override `process.env` (tests). */
  env?: Record<string, string | undefined>;
}

export async function runDeploy(args: string[], options: RunDeployOptions = {}): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(DEPLOY_SPEC, args, options.env ?? process.env);
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

  const targetRaw = parsed.positionals[0];
  if (targetRaw === undefined) {
    process.stderr.write('Missing required argument: <target>\n\n');
    process.stderr.write(formatCommandHelp(DEPLOY_SPEC));
    return EXIT_CODES.usage;
  }
  if (!isDeployTarget(targetRaw)) {
    process.stderr.write(
      `Unknown deploy target: ${targetRaw} (expected one of: ${DEPLOY_TARGETS.join(', ')})\n\n`,
    );
    process.stderr.write(formatCommandHelp(DEPLOY_SPEC));
    return EXIT_CODES.usage;
  }
  const target: DeployTarget = targetRaw;

  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  const dryRun = parsed.values['dry-run'] === true;
  const runBuildFirst = parsed.values.build === true;

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
    process.stdout.write(`${plan.summary}\n`);
    return EXIT_CODES.ok;
  }

  return await executePlan(plan);
}

export interface PlanDeployArgs {
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
  const argv = ['s3', 'sync', args.outputDir, `s3://${bucket}`];
  if (cfg.delete) argv.push('--delete');
  if (region) argv.push('--region', region);
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
    env: args.env,
    cwd: args.cwd,
    summary: shellQuote(['aws', ...argv]),
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
  logger.info(`Deploying via ${plan.command} ${plan.args.join(' ')}`);
  const proc = Bun.spawn([plan.command, ...plan.args], {
    cwd: plan.cwd,
    env: filterDefinedEnv(plan.env),
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) {
    process.stderr.write(`${plan.command} exited with code ${code}\n`);
    return EXIT_CODES.generic;
  }
  return EXIT_CODES.ok;
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
