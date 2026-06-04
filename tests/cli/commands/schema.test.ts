import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe('schema command', () => {
  test.each([
    ['config', 'LaurelConfig'],
    ['frontmatter', 'LaurelFrontmatter'],
    ['theme', 'LaurelThemePackage'],
  ] as const)('prints %s JSON Schema to stdout only', async (target, definitionName) => {
    const result = await runCli(['schema', target]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.startsWith('{\n')).toBe(true);

    const parsed = JSON.parse(result.stdout) as {
      $schema?: string;
      $ref?: string;
      definitions?: Record<string, unknown>;
    };
    expect(parsed.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(parsed.$ref).toBe(`#/definitions/${definitionName}`);
    expect(parsed.definitions?.[definitionName]).toBeTruthy();
  });

  test('config schema exposes the existing config shape', async () => {
    const result = await runCli(['schema', 'config']);
    const parsed = JSON.parse(result.stdout) as {
      definitions: {
        LaurelConfig: {
          properties: {
            site: { properties: Record<string, unknown>; required?: string[] };
            build: { properties: Record<string, unknown> };
          };
        };
      };
    };

    expect(parsed.definitions.LaurelConfig.properties.site.properties.title).toMatchObject({
      type: 'string',
    });
    expect(parsed.definitions.LaurelConfig.properties.site.properties.url).toMatchObject({
      format: 'uri',
    });
    expect(parsed.definitions.LaurelConfig.properties.build.properties.output_dir).toMatchObject({
      type: 'string',
    });
  });

  test('frontmatter schema covers content entry fields', async () => {
    const result = await runCli(['schema', 'frontmatter']);
    const parsed = JSON.parse(result.stdout) as {
      definitions: {
        LaurelFrontmatter: {
          anyOf: Array<{
            properties: Record<string, unknown>;
            required?: string[];
          }>;
        };
      };
    };

    const postSchema = parsed.definitions.LaurelFrontmatter.anyOf[0];
    expect(postSchema?.required).toContain('title');
    expect(postSchema?.properties.visibility).toMatchObject({
      enum: ['public', 'members', 'paid', 'tiers', 'filter'],
    });
    expect(postSchema?.properties.tags).toMatchObject({
      anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    });
    expect(postSchema?.properties.custom_template).toBeTruthy();
    expect(postSchema?.properties.custom_template).toMatchObject({
      description: 'Custom post template slug, with or without custom-.',
    });

    const pageSchema = parsed.definitions.LaurelFrontmatter.anyOf[1];
    expect(pageSchema?.properties.custom_template).toBeTruthy();
    expect(pageSchema?.properties.custom_template).toMatchObject({
      description: 'Custom page template slug, with or without custom-.',
    });
    expect(pageSchema?.properties.show_title_and_feature_image).toMatchObject({
      type: 'boolean',
    });
  });

  test('theme schema covers package.json config fields', async () => {
    const result = await runCli(['schema', 'theme']);
    const parsed = JSON.parse(result.stdout) as {
      definitions: {
        LaurelThemePackage: {
          properties: {
            config: {
              properties: Record<string, unknown>;
            };
          };
        };
      };
    };

    expect(parsed.definitions.LaurelThemePackage.properties.config.properties).toMatchObject({
      posts_per_page: { type: 'number' },
      image_sizes: { type: 'object' },
      card_assets: {
        anyOf: [
          { type: 'boolean' },
          { type: 'array', items: { type: 'string' } },
          { type: 'object' },
        ],
      },
      custom: { type: 'object' },
    });
  });

  test('unknown targets fail without writing JSON to stdout', async () => {
    const result = await runCli(['schema', 'unknown']);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown schema target: unknown');
  });
});
