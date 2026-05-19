import { formatNectarError, isNectarError } from '~/util/errors.ts';
import { logger } from '~/util/logger.ts';

export function reportError(err: unknown, cwd: string = process.cwd()): void {
  if (isNectarError(err)) {
    logger.error(formatNectarError(err, { cwd }));
    return;
  }
  if (err instanceof Error) {
    logger.error(err.message);
    return;
  }
  logger.error(String(err));
}
