import { isAbsolute, resolve } from 'node:path';
import { importComponentsBundle } from '~/components-bundle/index.ts';
import { loadConfig } from '~/config/loader.ts';
import { type ConflictPolicy, importEntryBundle } from '~/entry-bundle/index.ts';
import { EXIT_CODES, exitCodeForError } from '~/util/errors.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { reportError } from '../report.ts';
import { IMPORT_SPEC } from '../specs.ts';

const ON_CONFLICT_VALUES: readonly ConflictPolicy[] = ['skip', 'overwrite', 'rename'];
const IMPORT_KINDS = ['entry', 'components'] as const;

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
  if (kind !== 'entry' && kind !== 'components') {
    process.stderr.write(
      `Missing or unknown import kind: expected one of: ${IMPORT_KINDS.join(', ')}\n\n`,
    );
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
  const onConflict: ConflictPolicy =
    typeof rawOnConflict === 'string' ? (rawOnConflict as ConflictPolicy) : 'skip';
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
    const zip = new Uint8Array(await Bun.file(abs).arrayBuffer());
    const result =
      kind === 'components'
        ? await importComponentsBundle({ cwd, config, zip, onConflict, dryRun })
        : await importEntryBundle({ cwd, config, zip, onConflict, dryRun });
    process.stdout.write(`${JSON.stringify({ ok: true, dryRun, result })}\n`);
    return EXIT_CODES.ok;
  } catch (err) {
    reportError(err, cwd);
    return exitCodeForError(err);
  }
}
