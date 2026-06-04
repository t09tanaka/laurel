import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveSourcePosition } from '~/cli/source-map-stack.ts';

const tempDirs: string[] = [];
const SOURCE_MAP_STACK_MODULE = pathToFileURL(
  join(import.meta.dir, '../../src/cli/source-map-stack.ts'),
).href;

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'laurel-sourcemap-'));
  tempDirs.push(dir);
  return dir;
}

describe('source map stack trace support', () => {
  test('resolves generated bundle positions to original TypeScript sources', async () => {
    const dir = await makeTempDir();
    const generated = join(dir, 'cli.mjs');
    const source = join(dir, 'src', 'command.ts');
    await writeFile(generated, 'first line\nthrow new Error("boom");\n', 'utf8');
    await writeFile(
      `${generated}.map`,
      JSON.stringify({
        version: 3,
        sources: ['src/command.ts'],
        // Generated line 2, column 0 maps to source line 10, column 3.
        mappings: ';AASE',
      }),
      'utf8',
    );

    expect(resolveSourcePosition(generated, 2, 8)).toEqual({
      file: source,
      line: 10,
      column: 3,
    });
  });

  test('returns null when no external source map is available', async () => {
    const dir = await makeTempDir();
    const generated = join(dir, 'cli.mjs');
    await writeFile(generated, 'throw new Error("boom");\n', 'utf8');

    expect(resolveSourcePosition(generated, 1, 1)).toBeNull();
  });

  test('Error.prepareStackTrace prints mapped TypeScript frames', async () => {
    const dir = await makeTempDir();
    const generated = join(dir, 'generated.mjs');
    const runner = join(dir, 'runner.mjs');
    const source = join(dir, 'src', 'command.ts');
    await mkdir(join(dir, 'src'));
    await writeFile(source, 'throw new Error("mapped");\n', 'utf8');
    await writeFile(
      generated,
      'export function boom() {\n  throw new Error("mapped");\n}\n//# sourceMappingURL=generated.mjs.map\n',
      'utf8',
    );
    await writeFile(
      `${generated}.map`,
      JSON.stringify({
        version: 3,
        sources: ['src/command.ts'],
        mappings: ';AASE',
      }),
      'utf8',
    );
    await writeFile(
      runner,
      `import { installSourceMapStackTraceSupport } from ${JSON.stringify(SOURCE_MAP_STACK_MODULE)};
import { boom } from './generated.mjs';
installSourceMapStackTraceSupport();
try {
  boom();
} catch (err) {
  process.stdout.write(String(err.stack));
}
`,
      'utf8',
    );

    const proc = Bun.spawn(['bun', runner], { stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain(`Error: mapped\n    at boom (${await realpath(source)}:10:3)`);
  });
});
