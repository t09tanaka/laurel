import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { logger } from '~/util/logger.ts';

// `nectar theme:lint <path>` is a lightweight, Ghost-flavoured theme audit.
// It is *not* a port of gscan — gscan validates against Ghost API contracts
// we don't host. Instead, this checks the bare-minimum subset a Nectar build
// will trip over: missing templates, missing canonical helpers in
// `default.hbs`, and recommended partials that themes-in-the-wild assume.
//
// The lint is deliberately permissive: required-template absence is an error
// (level: 'error'); helper / partial omissions are warnings (level: 'warn').
// Errors fail the exit code so CI gates can wrap this; warnings just print.

export interface LintFinding {
  level: 'error' | 'warn';
  code: string;
  message: string;
  file?: string;
}

export interface LintReport {
  themePath: string;
  findings: LintFinding[];
  errors: number;
  warnings: number;
}

// Ghost themes only strictly need `default.hbs` + `index.hbs`, but Nectar's
// router emits post and page routes unconditionally, so missing `post.hbs` /
// `page.hbs` is also an error here. `home.hbs` is treated as a valid
// substitute for `index.hbs` (Ghost looks up `home.hbs` first when present).
const REQUIRED_TEMPLATES: Array<{ name: string; alt?: string }> = [
  { name: 'default.hbs' },
  { name: 'index.hbs', alt: 'home.hbs' },
  { name: 'post.hbs' },
  { name: 'page.hbs' },
];

// Helpers that *must* appear somewhere inside default.hbs for the rendered
// HTML to carry the Ghost-compatible metadata themes are paid to produce.
// `{{ghost_head}}` and `{{ghost_foot}}` inject the asset/script tags; missing
// them breaks anything that depends on canonical URLs, OG tags, etc.
const REQUIRED_DEFAULT_HELPERS = ['ghost_head', 'ghost_foot', 'body_class'];

// Per-template helpers Nectar leans on for the right HTML class hooks. We
// check these on the matching template only (so a theme that uses partials
// to compose post.hbs still passes if the helper lives in the partial — we
// scan the partials directory too).
const POST_CLASS_TARGETS = ['post.hbs', 'page.hbs'];

const RECOMMENDED_PARTIALS = ['partials/navigation.hbs', 'partials/pagination.hbs'];

// Ghost retired these helper names; they used to work on older Ghost versions
// and still appear in old themes. They are silently ignored by Nectar, which
// usually surfaces as visual regressions rather than build errors, so warn.
const DEPRECATED_HELPERS = ['amp_components', 'amp_content', 'amp_ghost_head'];

export async function lintTheme(themePath: string): Promise<LintReport> {
  const findings: LintFinding[] = [];
  if (!existsSync(themePath)) {
    findings.push({
      level: 'error',
      code: 'theme-not-found',
      message: `Theme directory does not exist: ${themePath}`,
    });
    return summarise(themePath, findings);
  }

  const files = await listFiles(themePath);
  const fileSet = new Set(files);

  for (const req of REQUIRED_TEMPLATES) {
    if (fileSet.has(req.name)) continue;
    if (req.alt && fileSet.has(req.alt)) continue;
    findings.push({
      level: 'error',
      code: 'missing-required-template',
      message: req.alt
        ? `Required template missing: ${req.name} (or ${req.alt})`
        : `Required template missing: ${req.name}`,
    });
  }

  if (fileSet.has('default.hbs')) {
    const defaultSrc = await readFile(join(themePath, 'default.hbs'), 'utf8');
    for (const helper of REQUIRED_DEFAULT_HELPERS) {
      if (!containsHelper(defaultSrc, helper)) {
        findings.push({
          level: 'error',
          code: 'missing-required-helper',
          message: `default.hbs is missing required helper: {{${helper}}}`,
          file: 'default.hbs',
        });
      }
    }
  }

  // post_class lives on the article wrapper; either post.hbs / page.hbs
  // include it directly, or they delegate via partials. We accept either by
  // scanning the partials/ directory too.
  const partialBlob = await readAllSources(themePath, files, (f) => f.startsWith('partials/'));
  for (const tpl of POST_CLASS_TARGETS) {
    if (!fileSet.has(tpl)) continue;
    const src = await readFile(join(themePath, tpl), 'utf8');
    if (!containsHelper(src, 'post_class') && !containsHelper(partialBlob, 'post_class')) {
      findings.push({
        level: 'error',
        code: 'missing-required-helper',
        message: `${tpl} is missing required helper: {{post_class}} (also not found in partials/)`,
        file: tpl,
      });
    }
  }

  for (const partial of RECOMMENDED_PARTIALS) {
    if (!fileSet.has(partial)) {
      findings.push({
        level: 'warn',
        code: 'missing-recommended-partial',
        message: `Recommended partial missing: ${partial}`,
      });
    }
  }

  // Deprecated-helper scan covers every .hbs in the theme (templates +
  // partials). One warning per (helper, file) so a theme that uses the same
  // dead helper everywhere doesn't spam the report from one source of truth.
  for (const file of files) {
    if (!file.endsWith('.hbs')) continue;
    const src = await readFile(join(themePath, file), 'utf8');
    for (const helper of DEPRECATED_HELPERS) {
      if (containsHelper(src, helper)) {
        findings.push({
          level: 'warn',
          code: 'deprecated-helper',
          message: `Deprecated helper {{${helper}}} used`,
          file,
        });
      }
    }
  }

  return summarise(themePath, findings);
}

function summarise(themePath: string, findings: LintFinding[]): LintReport {
  let errors = 0;
  let warnings = 0;
  for (const f of findings) {
    if (f.level === 'error') errors += 1;
    else warnings += 1;
  }
  return { themePath, findings, errors, warnings };
}

// Helper invocation detection has to be loose enough to catch `{{ghost_head}}`,
// `{{ghost_head foo}}`, `{{#post_class}}`, `{{> partials/pagination}}` etc.,
// but tight enough not to match a word inside an attribute string. Anchoring
// to `{{`, optional sigils (`#`, `^`, `&`, `>`, `!`, `{`), optional whitespace,
// then the helper name followed by a word boundary covers the realistic forms
// without over-matching.
function containsHelper(source: string, helper: string): boolean {
  const escaped = helper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(String.raw`\{\{[#^&>!{]?\s*${escaped}\b`);
  return re.test(source);
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.cache', '.nectar-cache']);
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        await walk(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      out.push(relative(root, join(dir, entry.name)).replaceAll('\\', '/'));
    }
  }
  await walk(root);
  out.sort();
  return out;
}

async function readAllSources(
  root: string,
  files: string[],
  filter: (f: string) => boolean,
): Promise<string> {
  const parts: string[] = [];
  for (const f of files) {
    if (!filter(f)) continue;
    if (!f.endsWith('.hbs')) continue;
    parts.push(await readFile(join(root, f), 'utf8'));
  }
  return parts.join('\n');
}

// Table output keeps the layout aligned on level / code / file / message.
// Findings sorted error-first so the most important rows appear at the top
// for a human eyeballing the output.
export function formatReportTable(report: LintReport): string {
  const lines: string[] = [];
  lines.push(`Theme: ${report.themePath}`);
  if (report.findings.length === 0) {
    lines.push('No issues found.');
    return `${lines.join('\n')}\n`;
  }
  const sorted = [...report.findings].sort((a, b) => {
    if (a.level !== b.level) return a.level === 'error' ? -1 : 1;
    return (a.file ?? '').localeCompare(b.file ?? '') || a.code.localeCompare(b.code);
  });
  lines.push('');
  lines.push(`${pad('LEVEL', 6)} ${pad('CODE', 28)} ${pad('FILE', 24)} MESSAGE`);
  lines.push(`${'-'.repeat(6)} ${'-'.repeat(28)} ${'-'.repeat(24)} -------`);
  for (const f of sorted) {
    lines.push(
      `${pad(f.level.toUpperCase(), 6)} ${pad(f.code, 28)} ${pad(f.file ?? '-', 24)} ${f.message}`,
    );
  }
  lines.push('');
  lines.push(`Errors: ${report.errors}  Warnings: ${report.warnings}`);
  return `${lines.join('\n')}\n`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

export function formatReportJson(report: LintReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export async function runThemeLint(opts: {
  themePath: string;
  asJson: boolean;
}): Promise<number> {
  try {
    const report = await lintTheme(opts.themePath);
    const out = opts.asJson ? formatReportJson(report) : formatReportTable(report);
    process.stdout.write(out);
    return report.errors > 0 ? 1 : 0;
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
