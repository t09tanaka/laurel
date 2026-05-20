import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { TELEMETRY_SPEC } from '../specs.ts';
import {
  DEFAULT_TELEMETRY_ENDPOINT,
  disableTelemetry,
  enableTelemetry,
  readTelemetryConfig,
  resolveTelemetryEndpoint,
  telemetryConfigPath,
} from '../telemetry.ts';

export async function runTelemetry(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(TELEMETRY_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(TELEMETRY_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(TELEMETRY_SPEC));
    return 0;
  }

  const subcommand = parsed.positionals[0];
  if (subcommand === 'enable') {
    const endpoint =
      typeof parsed.values.endpoint === 'string' ? parsed.values.endpoint : undefined;
    const config = await enableTelemetry(endpoint, process.env);
    process.stdout.write('Telemetry enabled.\n');
    process.stdout.write(`Endpoint: ${resolveTelemetryEndpoint(config, process.env)}\n`);
    process.stdout.write(`Anonymous machine id: ${config.anonymousMachineId}\n`);
    return 0;
  }

  if (subcommand === 'disable') {
    await disableTelemetry(process.env);
    process.stdout.write('Telemetry disabled.\n');
    return 0;
  }

  if (subcommand === 'status') {
    const config = await readTelemetryConfig(process.env);
    const status = config.enabled ? 'enabled' : 'disabled';
    process.stdout.write(`Telemetry: ${status}\n`);
    process.stdout.write(`Config: ${telemetryConfigPath(process.env)}\n`);
    process.stdout.write(`Endpoint: ${resolveTelemetryEndpoint(config, process.env)}\n`);
    process.stdout.write(`Default endpoint: ${DEFAULT_TELEMETRY_ENDPOINT}\n`);
    process.stdout.write(`Anonymous machine id: ${config.anonymousMachineId ?? '(not created)'}\n`);
    return 0;
  }

  process.stderr.write(
    `Unknown telemetry subcommand: ${subcommand}. Expected enable, disable, or status.\n\n`,
  );
  process.stderr.write(formatCommandHelp(TELEMETRY_SPEC));
  return 2;
}
