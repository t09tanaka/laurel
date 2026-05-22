import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { loadConfig } from '~/config/loader.ts';
import {
  type PageBundleConflictPolicy,
  importPageBundle,
  parsePageBundle,
} from '~/page-bundle/index.ts';
import { EXIT_CODES, exitCodeForError } from '~/util/errors.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { IMPORT_SPEC } from '../specs.ts';

const ON_CONFLICT_VALUES: readonly PageBundleConflictPolicy[] = ['skip', 'overwrite', 'rename'];

export async function runImport(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(IMPORT_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(IMPORT_SPEC));
      return EXIT_CODES.usage;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(IMPORT_SPEC));
    return EXIT_CODES.ok;
  }

  const kind = parsed.positionals[0];
  if (kind !== 'page') {
    process.stderr.write('Missing or unknown import kind: expected `page`\n\n');
    process.stderr.write(formatCommandHelp(IMPORT_SPEC));
    return EXIT_CODES.usage;
  }
  const file = parsed.positionals[1];
  if (!file) {
    process.stderr.write('Missing required argument: <file>\n\n');
    process.stderr.write(formatCommandHelp(IMPORT_SPEC));
    return EXIT_CODES.usage;
  }

  const rawOnConflict = parsed.values['on-conflict'];
  const onConflict =
    typeof rawOnConflict === 'string' ? (rawOnConflict as PageBundleConflictPolicy) : 'skip';
  if (!(ON_CONFLICT_VALUES as readonly string[]).includes(onConflict)) {
    process.stderr.write(
      `Invalid --on-conflict value: ${rawOnConflict} (expected one of: ${ON_CONFLICT_VALUES.join(', ')})\n\n`,
    );
    process.stderr.write(formatCommandHelp(IMPORT_SPEC));
    return EXIT_CODES.usage;
  }

  const cwd = process.cwd();
  const configPath = typeof parsed.values.config === 'string' ? parsed.values.config : undefined;
  const dryRun = parsed.values['dry-run'] === true;
  try {
    const config = await loadConfig({ cwd, configPath });
    const abs = isAbsolute(file) ? file : resolve(cwd, file);
    const bundle = parsePageBundle(JSON.parse(await readFile(abs, 'utf8')));
    const result = await importPageBundle({ cwd, config, bundle, onConflict, dryRun });
    process.stdout.write(`${JSON.stringify({ ok: true, dryRun, result })}\n`);
    return EXIT_CODES.ok;
  } catch (err) {
    reportError(err, cwd);
    return exitCodeForError(err);
  }
}
