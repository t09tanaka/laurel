import { relative } from 'node:path';
import { type LintIssue, lintContent } from '~/build/lint.ts';
import { type RedirectRule, collapseRedirects, loadRedirects } from '~/build/redirects.ts';
import { loadRoutesYaml } from '~/build/routes-yaml.ts';
import { planRoutes } from '~/build/routes.ts';
import { loadContent } from '~/content/loader.ts';
import type { RouteContext } from '~/render/types.ts';
import { compileThemeTemplates } from '~/theme/compile-check.ts';
import { loadTheme } from '~/theme/loader.ts';
import { validateThemeCustom } from '~/theme/validate-custom.ts';
import { getWarningCount, logger, resetWarningCount } from '~/util/logger.ts';
import { withBasePath } from '~/util/url.ts';
import { type FrontmatterIssue, checkFrontmatterSchemas } from '../check-frontmatter.ts';
import { type TemplateIssue, checkThemeTemplates } from '../check-templates.ts';
import { reportConfigValidationError, validateConfigOnly } from '../config-validation.ts';
import { ensureContentDirs } from '../ensure-content-dirs.ts';
import { t } from '../i18n/index.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { CHECK_SPEC } from '../specs.ts';

interface CheckReport {
  ok: boolean;
  errors: ReportEntry[];
  warnings: ReportEntry[];
  summary: {
    posts: number;
    pages: number;
    tags: number;
    authors: number;
    templates: number;
    partials: number;
  } | null;
}

interface ReportEntry {
  file?: string;
  line?: number;
  col?: number;
  code: string;
  message: string;
}

export async function runCheck(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(CHECK_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(CHECK_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(CHECK_SPEC));
    return 0;
  }

  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  const strict = parsed.values.strict === true;
  const checkLinks = parsed.values['check-links'] === true;
  const checkExternal = parsed.values['check-external'] === true;
  const checkFrontmatter = parsed.values['check-frontmatter'] === true;
  const checkTemplates = parsed.values['check-templates'] === true;
  const asJson = parsed.values.json === true;
  const cwd = process.cwd();

  resetWarningCount();

  const errors: ReportEntry[] = [];
  const warnings: ReportEntry[] = [];

  try {
    const configResult = await validateConfigOnly({ cwd, configPath });
    if (!configResult.ok) {
      if (asJson) {
        const report: CheckReport = {
          ok: false,
          errors: [{ code: 'fatal', message: configResult.entry.message }],
          warnings,
          summary: null,
        };
        process.stdout.write(`${JSON.stringify(report)}\n`);
      } else {
        reportConfigValidationError(configResult, cwd);
      }
      return 1;
    }
    const config = configResult.config;
    if (!asJson) logger.info(t('check.configOk', { title: config.site.title }));

    // Auto-create missing content dirs with a warning so a fresh checkout
    // doesn't get a hard ENOENT on `nectar check`. The warning lands in
    // both `getWarningCount()` and the JSON report.
    await ensureContentDirs(cwd, config);

    const routesYaml = await loadRoutesYaml(cwd);
    const content = await loadContent({ cwd, config, routesYaml });
    if (!asJson) {
      logger.info(
        t('check.contentOk', {
          posts: content.posts.length,
          pages: content.pages.length,
          tags: content.tags.length,
          authors: content.authors.length,
        }),
      );
    }

    const theme = await loadTheme({ cwd, config });
    const compileIssues = compileThemeTemplates(theme);
    for (const issue of compileIssues) {
      errors.push({
        file: issue.file,
        code: 'theme/compile',
        message: t('check.themeCompileFailed', {
          kind: issue.kind,
          name: issue.name,
          file: issue.file,
          message: issue.message,
        }),
      });
    }
    if (compileIssues.length > 0 && !asJson) {
      for (const e of errors) logger.error(e.message);
      // Compile errors are fatal; surface immediately.
      return finalize(errors, warnings, null, asJson, false);
    }
    if (!asJson) {
      logger.info(
        t('check.themeOk', {
          name: theme.name,
          templates: Object.keys(theme.templates).length,
          partials: Object.keys(theme.partials).length,
        }),
      );
    }
    validateThemeCustom({ config, pkg: theme.pkg });

    const routes = planRoutes({ config, content, theme, routesYaml });
    const redirectShadowWarnings = await checkRedirectRouteShadows({
      cwd,
      basePath: config.build.base_path,
      routes,
    });
    warnings.push(...redirectShadowWarnings);
    if (!asJson) {
      for (const warning of redirectShadowWarnings) {
        logger.warn(`${warning.message} [${warning.code}]`);
      }
    }

    if (checkFrontmatter) {
      const fmIssues = await checkFrontmatterSchemas({ cwd, config });
      for (const issue of fmIssues) collectFrontmatterIssue(issue, cwd, errors, warnings);
      if (!asJson) {
        for (const e of fmIssues) {
          const loc = formatLoc(e.file, e.line, cwd);
          const msg = `${loc} - ${e.message} [${e.code}]`;
          if (e.severity === 'error') logger.error(msg);
          else logger.warn(msg);
        }
      }
    }

    if (checkTemplates) {
      const tIssues = checkThemeTemplates(theme, content);
      for (const issue of tIssues) collectTemplateIssue(issue, errors, warnings);
      if (!asJson) {
        for (const t of tIssues) {
          if (t.severity === 'error') logger.error(`${t.message} [theme/${t.reason}]`);
          else logger.warn(`${t.message} [theme/${t.reason}]`);
        }
      }
    }

    const lintReport = await lintContent({
      cwd,
      config,
      content,
      checkLinks,
      checkExternal,
    });
    for (const issue of lintReport.warnings)
      collectLintIssue(issue, 'warning', cwd, errors, warnings);
    for (const issue of lintReport.errors) collectLintIssue(issue, 'error', cwd, errors, warnings);
    if (!asJson) {
      for (const issue of lintReport.warnings) emitIssue(issue, 'warning');
      for (const issue of lintReport.errors) emitIssue(issue, 'error');
    }

    const summary = {
      posts: content.posts.length,
      pages: content.pages.length,
      tags: content.tags.length,
      authors: content.authors.length,
      templates: Object.keys(theme.templates).length,
      partials: Object.keys(theme.partials).length,
    };

    if (errors.length > 0) {
      if (!asJson) {
        logger.error(
          t('check.errorsFound', {
            count: errors.length,
            plural: errors.length === 1 ? '' : 's',
          }),
        );
      }
      return finalize(errors, warnings, summary, asJson, false);
    }

    if (strict) {
      const w = getWarningCount();
      if (w > 0) {
        if (!asJson) {
          logger.error(
            t('check.strict.failed', {
              count: w,
              plural: w === 1 ? '' : 's',
            }),
          );
        }
        return finalize(errors, warnings, summary, asJson, false);
      }
    }

    return finalize(errors, warnings, summary, asJson, true);
  } catch (err) {
    if (asJson) {
      // Wrap a thrown error into the report shape so machine consumers always
      // get a JSON document on stdout, regardless of where the failure
      // happened. The human-readable text path still uses `reportError`.
      const e = err instanceof Error ? err : new Error(String(err));
      const report: CheckReport = {
        ok: false,
        errors: [{ code: 'fatal', message: e.message }],
        warnings,
        summary: null,
      };
      process.stdout.write(`${JSON.stringify(report)}\n`);
      return 1;
    }
    reportError(err, cwd);
    return 1;
  }
}

function finalize(
  errors: ReportEntry[],
  warnings: ReportEntry[],
  summary: CheckReport['summary'],
  asJson: boolean,
  ok: boolean,
): number {
  if (asJson) {
    const report: CheckReport = { ok, errors, warnings, summary };
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else if (ok) {
    logger.info('All checks passed');
  } else {
    logger.error(formatCheckIssueSummary(errors.length, warnings.length));
  }
  return ok ? 0 : 1;
}

function formatCheckIssueSummary(errorCount: number, warningCount: number): string {
  const errorLabel = errorCount === 1 ? 'error' : 'errors';
  const warningLabel = warningCount === 1 ? 'warning' : 'warnings';
  return `${errorCount} ${errorLabel}, ${warningCount} ${warningLabel}`;
}

function formatLoc(file: string, line: number | undefined, cwd: string): string {
  const rel = relative(cwd, file);
  const path = rel && !rel.startsWith('..') ? rel : file;
  return line !== undefined ? `${path}:${line}` : path;
}

function emitIssue(issue: LintIssue, level: 'warning' | 'error'): void {
  const location = issue.file ? `${issue.file}: ` : '';
  const message = `${location}${issue.message} [${issue.code}]`;
  if (level === 'error') logger.error(message);
  else logger.warn(message);
}

async function checkRedirectRouteShadows(opts: {
  cwd: string;
  basePath: string;
  routes: readonly RouteContext[];
}): Promise<ReportEntry[]> {
  const redirects = collapseRedirects(await loadRedirects(opts.cwd));
  if (redirects.length === 0 || opts.routes.length === 0) return [];

  const routeBySource = buildShadowableRouteSources(opts.routes, opts.basePath);
  const warnings: ReportEntry[] = [];
  for (const redirect of redirects) {
    if (!isExactRedirectSource(redirect)) continue;
    const route = routeBySource.get(redirect.from);
    if (!route) continue;
    warnings.push({
      file: 'redirects.yaml',
      code: 'redirect-shadows-route',
      message: `redirects.yaml: redirect from ${redirect.from} is shadowed by generated route ${route.url} (${route.outputPath}); on static hosts that prefer files, the route can win before this redirect runs.`,
    });
  }
  return warnings;
}

function buildShadowableRouteSources(
  routes: readonly RouteContext[],
  basePath: string,
): Map<string, Pick<RouteContext, 'url' | 'outputPath'>> {
  const normalizedBasePath = normalizeBasePathForMatch(basePath);
  const out = new Map<string, Pick<RouteContext, 'url' | 'outputPath'>>();
  for (const route of routes) {
    const deployedUrl = withBasePath(normalizedBasePath, route.url);
    for (const source of shadowableSourcesForRoute(deployedUrl, route.outputPath)) {
      if (!out.has(source)) out.set(source, { url: route.url, outputPath: route.outputPath });
    }
  }
  return out;
}

function shadowableSourcesForRoute(deployedUrl: string, outputPath: string): string[] {
  const sources = [deployedUrl];
  if (outputPath === 'index.html' || outputPath.endsWith('/index.html')) {
    const slashless = deployedUrl.endsWith('/') ? deployedUrl.slice(0, -1) : deployedUrl;
    if (slashless && slashless !== deployedUrl) sources.push(slashless);
  }
  return sources;
}

function isExactRedirectSource(rule: RedirectRule): boolean {
  return (
    rule.from.startsWith('/') &&
    !rule.from.includes('*') &&
    !rule.from.includes('?') &&
    !rule.from.includes('#')
  );
}

function normalizeBasePathForMatch(basePath: string): string {
  const trimmed = basePath.trim();
  if (!trimmed || trimmed === '/') return '/';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const withTrailingSlash = withLeadingSlash.endsWith('/')
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
  return withTrailingSlash.replace(/\/{2,}/g, '/');
}

function collectFrontmatterIssue(
  issue: FrontmatterIssue,
  cwd: string,
  errors: ReportEntry[],
  warnings: ReportEntry[],
): void {
  const rel = relative(cwd, issue.file);
  const file = rel && !rel.startsWith('..') ? rel : issue.file;
  const entry: ReportEntry = {
    file,
    code: issue.code,
    message: issue.message,
  };
  if (issue.line !== undefined) entry.line = issue.line;
  if (issue.severity === 'error') errors.push(entry);
  else warnings.push(entry);
}

function collectTemplateIssue(
  issue: TemplateIssue,
  errors: ReportEntry[],
  warnings: ReportEntry[],
): void {
  const entry: ReportEntry = {
    code: `theme/${issue.reason}`,
    message: issue.message,
  };
  if (issue.severity === 'error') errors.push(entry);
  else warnings.push(entry);
}

function collectLintIssue(
  issue: LintIssue,
  severity: 'warning' | 'error',
  cwd: string,
  errors: ReportEntry[],
  warnings: ReportEntry[],
): void {
  const entry: ReportEntry = { code: issue.code, message: issue.message };
  if (issue.file) {
    const rel = relative(cwd, issue.file);
    entry.file = rel && !rel.startsWith('..') ? rel : issue.file;
  }
  if (severity === 'error') errors.push(entry);
  else warnings.push(entry);
}
