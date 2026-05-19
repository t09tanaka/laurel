import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { loadConfig } from '~/config/loader.ts';
import { logger } from '~/util/logger.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { SERVE_SPEC } from '../specs.ts';

const DEFAULT_PORT = 4321;
const DEFAULT_HOST = 'localhost';

export async function runServe(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(SERVE_SPEC, args);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(SERVE_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(SERVE_SPEC));
    return 0;
  }

  let port = DEFAULT_PORT;
  if (typeof parsed.values.port === 'string') {
    const parsedPort = Number(parsed.values.port);
    if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      process.stderr.write(`Invalid --port value: ${parsed.values.port}\n`);
      return 2;
    }
    port = parsedPort;
  }

  let hostname = DEFAULT_HOST;
  if (typeof parsed.values.host === 'string') {
    const trimmed = parsed.values.host.trim();
    if (trimmed.length === 0) {
      process.stderr.write('Invalid --host value: cannot be empty\n');
      return 2;
    }
    hostname = trimmed;
  }

  const cwd = process.cwd();
  const config = await loadConfig({ cwd });
  const distDir = join(cwd, config.build.output_dir);

  if (!existsSync(distDir)) {
    logger.error(`No build output found at ${distDir}. Run \`nectar build\` first.`);
    return 1;
  }

  Bun.serve({
    port,
    hostname,
    async fetch(request) {
      const url = new URL(request.url);
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      const target = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
      const filePath = normalize(join(distDir, target));
      if (!filePath.startsWith(distDir)) {
        return new Response('Forbidden', { status: 403 });
      }
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }
      const fallback = Bun.file(join(distDir, '404.html'));
      if (await fallback.exists()) {
        return new Response(fallback, { status: 404 });
      }
      return new Response('Not Found', { status: 404 });
    },
  });

  const displayHost = hostname === '0.0.0.0' ? 'localhost' : hostname;
  logger.info(`Serving ${distDir} on http://${displayHost}:${port} (bound to ${hostname})`);
  return 0;
}
