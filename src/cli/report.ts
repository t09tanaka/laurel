import { formatLaurelError, isLaurelError } from '~/util/errors.ts';
import { getOutputMode, logger } from '~/util/logger.ts';

// Centralised error renderer for CLI commands. Three modes:
//   1. json (LAUREL_JSON=1 / --json): one JSON object on stderr via
//      logger.error, so machine consumers can `jq` it. Includes the
//      structured fields ({ file, line, col, hint, docsUrl, code }) when
//      they're present on a LaurelError.
//   2. text + LAUREL_DEBUG=1 / --debug: print the full stack so library
//      authors / contributors can pinpoint the throw site.
//   3. text default: print a short pointer line (`---- file:line - msg`)
//      with optional `hint:` / `docs:` follow-up lines. No stack trace,
//      no `at …` frames — end users don't need them.
// Always exits via the caller; this function only prints.
export function reportError(err: unknown, cwd: string = process.cwd()): void {
  const mode = getOutputMode();
  const debug = isDebugMode();

  if (mode === 'json') {
    const payload = serialiseError(err, { cwd, includeStack: debug });
    logger.error('error', payload);
    return;
  }

  if (isLaurelError(err)) {
    logger.error(formatLaurelError(err, { cwd }));
    if (debug && err.stack) {
      logger.error(err.stack);
    }
    return;
  }
  if (err instanceof Error) {
    if (debug && err.stack) {
      logger.error(err.stack);
    } else {
      logger.error(err.message);
    }
    return;
  }
  logger.error(String(err));
}

function isDebugMode(): boolean {
  const raw = process.env.LAUREL_DEBUG;
  if (raw === undefined || raw === '') return false;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

interface SerialiseOpts {
  cwd: string;
  includeStack: boolean;
}

interface SerialisedError {
  name: string;
  message: string;
  file?: string;
  line?: number;
  col?: number;
  hint?: string;
  docsUrl?: string;
  code?: string;
  stack?: string;
}

function serialiseError(err: unknown, opts: SerialiseOpts): SerialisedError {
  if (isLaurelError(err)) {
    const out: SerialisedError = {
      name: err.name,
      message: err.message,
    };
    if (err.file) out.file = relativise(opts.cwd, err.file);
    if (err.line !== undefined) out.line = err.line;
    if (err.col !== undefined) out.col = err.col;
    if (err.hint) out.hint = err.hint;
    if (err.docsUrl) out.docsUrl = err.docsUrl;
    if (err.code) out.code = err.code;
    if (opts.includeStack && err.stack) out.stack = err.stack;
    return out;
  }
  if (err instanceof Error) {
    const out: SerialisedError = { name: err.name, message: err.message };
    if (opts.includeStack && err.stack) out.stack = err.stack;
    return out;
  }
  return { name: 'Error', message: String(err) };
}

function relativise(cwd: string, file: string): string {
  // Mirror the formatter's behaviour without depending on node:path here so
  // this module remains side-effect-free. A simple prefix match is enough
  // because callers pass absolute paths.
  if (file.startsWith(`${cwd}/`)) return file.slice(cwd.length + 1);
  return file;
}
