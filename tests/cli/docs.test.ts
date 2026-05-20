import { describe, expect, test } from 'bun:test';
import { DEFAULT_GLOBAL_OPTIONS, renderCliReference } from '~/cli/docs.ts';
import type { CommandSpec } from '~/cli/parse.ts';
import { COMMAND_NAMES, COMMAND_SPECS } from '~/cli/specs.ts';

describe('renderCliReference', () => {
  test('emits the auto-generated banner', () => {
    const md = renderCliReference();
    expect(md).toContain('AUTO-GENERATED FILE');
    expect(md).toContain('bun run docs:cli');
  });

  test('lists every command in the spec map', () => {
    const md = renderCliReference();
    for (const name of COMMAND_NAMES) {
      const spec = COMMAND_SPECS[name];
      if (!spec) continue;
      expect(md).toContain(`### \`nectar ${name}\``);
      expect(md).toContain(spec.summary);
    }
  });

  test('renders every option flag and description', () => {
    const md = renderCliReference();
    for (const spec of Object.values(COMMAND_SPECS)) {
      for (const [name, opt] of Object.entries(spec.options)) {
        expect(md).toContain(`--${name}`);
        expect(md).toContain(opt.description);
      }
    }
  });

  test('renders positionals with their required/variadic markers', () => {
    const md = renderCliReference();
    expect(md).toContain('`<kind>`');
    expect(md).toContain('`<title...>`');
    expect(md).toContain('required (variadic)');
  });

  test('documents interleaved flag and positional parsing', () => {
    const md = renderCliReference();
    expect(md).toContain('## Argument order');
    expect(md).toContain('nectar new --slug foo post "Hello"');
    expect(md).toContain('`--` still ends option parsing');
  });

  test('includes the supplied global options', () => {
    const md = renderCliReference();
    for (const g of DEFAULT_GLOBAL_OPTIONS) {
      expect(md).toContain(g.flag);
      expect(md).toContain(g.description);
    }
  });

  test('documents repeated flag precedence and accumulation policy', () => {
    const md = renderCliReference();
    expect(md).toContain('## Repeated flags');
    expect(md).toContain('Scalar string flags use the last value');
    expect(md).toContain('List-style string flags accumulate');
  });

  test('documents generated text file line ending policy', () => {
    const md = renderCliReference();
    expect(md).toContain('## Generated text file line endings');
    expect(md).toContain('LF (`\\n`) line endings');
    expect(md).toContain('do not mix CRLF and LF endings');
  });

  test('escapes pipe characters inside option descriptions', () => {
    const spec: CommandSpec = {
      name: 'demo',
      summary: 'demo',
      options: {
        mode: {
          type: 'string',
          description: 'one of a|b|c',
          placeholder: '<a|b|c>',
        },
      },
      positionals: [],
    };
    const md = renderCliReference({ demo: spec }, ['demo']);
    expect(md).toContain('a\\|b\\|c');
    expect(md).not.toContain('| one of a|b|c |');
  });

  test('honors the order argument', () => {
    const md = renderCliReference(COMMAND_SPECS, ['build', 'init']);
    const buildIdx = md.indexOf('### `nectar build`');
    const initIdx = md.indexOf('### `nectar init`');
    expect(buildIdx).toBeGreaterThan(-1);
    expect(initIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeLessThan(initIdx);
  });

  test('the checked-in docs/cli.md matches the freshly rendered output', async () => {
    const onDisk = await Bun.file(new URL('../../docs/cli.md', import.meta.url)).text();
    const fresh = renderCliReference();
    expect(onDisk).toBe(fresh);
  });
});
