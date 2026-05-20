import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const extensionRoot = join(repoRoot, 'editors/vscode');
const cliEntry = join(repoRoot, 'src/cli/index.ts');

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

describe('VS Code extension', () => {
  test('manifest contributes Nectar language, tasks, problem matcher, and snippets', async () => {
    const manifest = await readJson<{
      main: string;
      activationEvents: string[];
      contributes: {
        languages: Array<{ id: string; filenames: string[] }>;
        grammars: Array<{ language: string; path: string }>;
        snippets: Array<{ language: string; path: string }>;
        problemMatchers: Array<{ name: string; pattern: { regexp: string } }>;
        taskDefinitions: Array<{ type: string; properties: { task: { enum: string[] } } }>;
      };
    }>(join(extensionRoot, 'package.json'));

    expect(manifest.main).toBe('./extension.js');
    expect(manifest.activationEvents).toContain('onTaskType:nectar');
    expect(manifest.contributes.languages).toContainEqual(
      expect.objectContaining({
        id: 'nectar-config',
        filenames: expect.arrayContaining(['nectar.config.toml', 'nectar.toml']),
      }),
    );
    expect(manifest.contributes.grammars).toContainEqual(
      expect.objectContaining({ language: 'nectar-config' }),
    );
    expect(manifest.contributes.snippets).toContainEqual(
      expect.objectContaining({ language: 'markdown' }),
    );
    const problemMatcher = manifest.contributes.problemMatchers[0];
    if (!problemMatcher) throw new Error('missing Nectar problem matcher');
    expect(problemMatcher).toMatchObject({
      name: 'nectar',
      pattern: {
        regexp: '^----\\s+(.+?)(?::(\\d+)(?::(\\d+))?)?\\s+-\\s+(.+)$',
      },
    });
    const taskDefinition = manifest.contributes.taskDefinitions[0];
    if (!taskDefinition) throw new Error('missing Nectar task definition');
    expect(taskDefinition.properties.task.enum).toEqual(['build', 'dev', 'check']);
  });

  test('extension JSON assets are valid', async () => {
    await readJson(join(extensionRoot, 'language-configuration/nectar-config.json'));
    await readJson(join(extensionRoot, 'grammars/nectar-config.tmLanguage.json'));
    const snippets = await readJson<Record<string, { prefix: string }>>(
      join(extensionRoot, 'snippets/frontmatter.code-snippets'),
    );

    expect(Object.values(snippets).map((snippet) => snippet.prefix)).toEqual([
      'nectar-post',
      'nectar-page',
      'nectar-tag',
      'nectar-author',
    ]);
  });

  test('bundled config schema matches the CLI schema output', async () => {
    const bundled = await readFile(
      join(extensionRoot, 'schemas/nectar.config.schema.json'),
      'utf8',
    );
    const proc = Bun.spawn(['bun', cliEntry, 'schema', 'config'], {
      cwd: repoRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    expect(await proc.exited).toBe(0);
    expect(stderr).toBe('');
    expect(JSON.parse(bundled)).toEqual(JSON.parse(stdout));
  });
});
