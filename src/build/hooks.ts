import { logger } from '~/util/logger.ts';

interface RunPostBuildHookOptions {
  cwd: string;
  outputDir: string;
  command: string | undefined;
}

export async function runPostBuildHook({
  cwd,
  outputDir,
  command,
}: RunPostBuildHookOptions): Promise<void> {
  if (!command) return;

  logger.info(`Running post_build hook: ${command}`);
  const proc = Bun.spawn(['sh', '-c', command], {
    cwd,
    env: {
      ...process.env,
      LAUREL_PROJECT_DIR: cwd,
      LAUREL_OUTPUT_DIR: outputDir,
    },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`post_build hook failed with exit code ${exitCode}: ${command}`);
  }
}
