import type { BuildProgressEvent, BuildProgressReporter } from '~/build/pipeline.ts';
import { type LogOutputMode, getOutputMode } from '~/util/logger.ts';
import { logger } from '~/util/logger.ts';

export type CliProgressMode = 'interactive' | 'plain';

interface ProgressWritable {
  write(chunk: string): unknown;
}

export interface BuildProgressDisplay {
  onProgress: BuildProgressReporter;
  finish: () => void;
}

export interface BuildProgressDisplayOptions {
  mode?: CliProgressMode | undefined;
  enabled?: boolean | undefined;
  stream?: ProgressWritable | undefined;
}

export interface ProgressDetectionInput {
  env?: Record<string, string | undefined>;
  stdout?: { isTTY?: boolean | undefined };
  stderr?: { isTTY?: boolean | undefined };
  outputMode?: LogOutputMode;
}

function envFlagEnabled(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  if (value === '' || value === '0' || value === 'false' || value === 'no' || value === 'off') {
    return false;
  }
  return true;
}

function isCiEnvironment(env: Record<string, string | undefined>): boolean {
  if (envFlagEnabled(env.CI)) return true;
  if (envFlagEnabled(env.GITHUB_ACTIONS)) return true;
  if (envFlagEnabled(env.GITLAB_CI)) return true;
  if (envFlagEnabled(env.BUILDKITE)) return true;
  if (envFlagEnabled(env.CIRCLECI)) return true;
  if (envFlagEnabled(env.VERCEL)) return true;
  if (envFlagEnabled(env.NETLIFY)) return true;
  return false;
}

export function detectCliProgressMode(input: ProgressDetectionInput = {}): CliProgressMode {
  const env = input.env ?? process.env;
  const outputMode = input.outputMode ?? getOutputMode();
  if (outputMode === 'json') return 'plain';
  if (isCiEnvironment(env)) return 'plain';
  if (env.TERM === 'dumb') return 'plain';

  const stdout = input.stdout ?? process.stdout;
  const stderr = input.stderr ?? process.stderr;
  if (stdout.isTTY !== true) return 'plain';
  if (stderr.isTTY !== true) return 'plain';

  return 'interactive';
}

export function getCliProgressMode(): CliProgressMode {
  return detectCliProgressMode();
}

export function canUseInteractiveProgress(input: ProgressDetectionInput = {}): boolean {
  return detectCliProgressMode(input) === 'interactive';
}

export function createBuildProgressDisplay(
  options: BuildProgressDisplayOptions = {},
): BuildProgressDisplay | undefined {
  if (options.enabled === false) return undefined;
  const mode = options.mode ?? getCliProgressMode();
  if (mode === 'interactive') {
    return createInteractiveBuildProgressDisplay(options.stream ?? process.stderr);
  }
  return createPlainBuildProgressDisplay();
}

function createInteractiveBuildProgressDisplay(stream: ProgressWritable): BuildProgressDisplay {
  const frames = ['-', '\\', '|', '/'];
  let frameIndex = 0;
  let activeLine = false;
  let lastLine = '';
  let renderTotal = 0;
  let renderDone = 0;

  const writeLine = (line: string): void => {
    lastLine = line;
    activeLine = true;
    stream.write(`\r\x1b[2K${line}`);
  };

  const completeLine = (line: string): void => {
    if (activeLine) {
      stream.write(`\r\x1b[2K${line}\n`);
    } else {
      stream.write(`${line}\n`);
    }
    activeLine = false;
    lastLine = '';
  };

  const spinner = (): string => {
    const frame = frames[frameIndex % frames.length] ?? '-';
    frameIndex += 1;
    return frame;
  };

  const onProgress = (event: BuildProgressEvent): void => {
    if (event.type === 'phase-start') {
      if (event.phase === 'render') {
        renderTotal = event.totalRoutes ?? renderTotal;
        renderDone = 0;
      }
      writeLine(`${spinner()} ${formatPhaseLabel(event)}...`);
      return;
    }
    if (event.type === 'routes-planned') {
      renderTotal = event.totalRoutes;
      writeLine(`${spinner()} Planned ${event.totalRoutes} routes`);
      return;
    }
    if (event.type === 'route-rendered') {
      renderDone = event.completedRoutes;
      renderTotal = event.totalRoutes;
      writeLine(`${spinner()} Rendering routes ${renderDone}/${renderTotal} ${event.route}`);
      return;
    }
    if (event.type === 'phase-end') {
      if (event.phase === 'render' && renderTotal > 0) {
        completeLine(`done Rendering routes ${renderDone}/${renderTotal}`);
        return;
      }
      completeLine(`done ${formatPhaseLabel(event)}`);
    }
  };

  return {
    onProgress,
    finish: () => {
      if (activeLine) {
        stream.write(`\r\x1b[2K${lastLine}\n`);
        activeLine = false;
      }
    },
  };
}

function createPlainBuildProgressDisplay(): BuildProgressDisplay {
  let lastPlainRoute = 0;

  const onProgress = (event: BuildProgressEvent): void => {
    if (event.type === 'phase-start') {
      logger.info(`Build: ${formatPhaseLabel(event)}...`);
      return;
    }
    if (event.type === 'routes-planned') {
      logger.info(`Build: planned ${event.totalRoutes} routes`);
      return;
    }
    if (event.type === 'route-rendered') {
      if (shouldLogPlainRouteProgress(event, lastPlainRoute)) {
        lastPlainRoute = event.completedRoutes;
        logger.info(`Build: rendered ${event.completedRoutes}/${event.totalRoutes} routes`);
      }
      return;
    }
    if (event.type === 'phase-end') {
      if (event.phase === 'render' && event.totalRoutes !== undefined) {
        logger.info(`Build: finished rendering ${event.totalRoutes} routes`);
        return;
      }
      logger.info(`Build: finished ${formatPhaseLabel(event).toLowerCase()}`);
    }
  };

  return {
    onProgress,
    finish: () => {},
  };
}

function shouldLogPlainRouteProgress(
  event: Extract<BuildProgressEvent, { type: 'route-rendered' }>,
  lastPlainRoute: number,
): boolean {
  if (event.totalRoutes <= 0) return false;
  if (event.completedRoutes === 1) return true;
  if (event.completedRoutes === event.totalRoutes) return true;
  return event.completedRoutes - lastPlainRoute >= 25;
}

function formatPhaseLabel(
  event: Extract<BuildProgressEvent, { type: 'phase-start' | 'phase-end' }>,
): string {
  if (event.phase === 'render' && event.totalRoutes !== undefined) {
    return `${event.label} (${event.totalRoutes} routes)`;
  }
  return event.label;
}
