import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { PLUGINS_SPEC } from '../specs.ts';

export async function runPlugins(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(PLUGINS_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(PLUGINS_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(PLUGINS_SPEC));
    return 0;
  }

  const [subcommand, ...rest] = parsed.positionals;
  if (subcommand !== 'list' || rest.length > 0) {
    process.stderr.write('Usage: nectar plugins list\n\n');
    process.stderr.write(formatCommandHelp(PLUGINS_SPEC));
    return 2;
  }

  if (parsed.values.json === true) {
    process.stdout.write(`${JSON.stringify({ plugins: [] })}\n`);
  } else {
    process.stdout.write('No plugins installed.\n');
  }
  return 0;
}
