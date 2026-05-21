import { collapseRedirects, loadAllRedirects } from '~/build/redirects.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { REDIRECTS_SPEC } from '../specs.ts';

export async function runRedirects(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(REDIRECTS_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(REDIRECTS_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(REDIRECTS_SPEC));
    return 0;
  }

  const sub = parsed.positionals[0];
  const cwd = process.cwd();
  const asJson = parsed.values.json === true;
  const collapsed = parsed.values.collapsed === true;

  if (sub !== 'list' && sub !== 'validate') {
    process.stderr.write(`Unknown subcommand: ${sub ?? ''}. Expected \`list\` or \`validate\`.\n`);
    return 2;
  }

  try {
    const loaded = await loadAllRedirects(cwd);
    const rules = collapsed ? collapseRedirects(loaded) : loaded;
    if (asJson) {
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            count: rules.length,
            collapsed,
            duplicates_dropped: loaded.length - collapseRedirects(loaded).length,
            redirects: sub === 'list' ? rules : undefined,
          },
          null,
          2,
        )}\n`,
      );
      return 0;
    }
    if (sub === 'validate') {
      process.stdout.write(
        `Loaded ${loaded.length} redirect rule(s); ${loaded.length - collapseRedirects(loaded).length} duplicate source rule(s) would be ignored by first-match emitters.\n`,
      );
      return 0;
    }
    if (rules.length === 0) {
      process.stdout.write('No redirects found.\n');
      return 0;
    }
    process.stdout.write(renderTable(rules));
    return 0;
  } catch (err) {
    reportError(err, cwd);
    return 1;
  }
}

function renderTable(
  rules: Array<{ from: string; to: string; status: number; force: boolean }>,
): string {
  const fromWidth = Math.max(4, ...rules.map((r) => r.from.length));
  const toWidth = Math.max(2, ...rules.map((r) => r.to.length));
  const lines = [`${pad('from', fromWidth)}  ${pad('to', toWidth)}  code  force`];
  lines.push(`${'-'.repeat(fromWidth)}  ${'-'.repeat(toWidth)}  ----  -----`);
  for (const rule of rules) {
    lines.push(
      `${pad(rule.from, fromWidth)}  ${pad(rule.to, toWidth)}  ${rule.status}   ${rule.force ? 'yes' : 'no'}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function pad(text: string, width: number): string {
  if (text.length >= width) return text;
  return text + ' '.repeat(width - text.length);
}
