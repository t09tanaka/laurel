import { formatCommandHelp } from '../parse.ts';
import { TEST_SPEC } from '../specs.ts';

interface WritableLike {
  write(chunk: string): unknown;
}

export interface TestRunOptions {
  stdout?: WritableLike;
  stderr?: WritableLike;
  run?: (command: string[]) => Promise<number>;
}

export async function runTest(args: string[], options: TestRunOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h' || args[0] === 'help')) {
    stdout.write(formatCommandHelp(TEST_SPEC));
    return 0;
  }

  stderr.write('Warning: `nectar test` is currently a passthrough to `bun test`.\n');
  const command = ['bun', 'test', ...args];
  if (options.run !== undefined) return options.run(command);

  const proc = Bun.spawn(command, {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return proc.exited;
}
