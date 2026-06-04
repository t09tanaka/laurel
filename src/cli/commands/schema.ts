import { zodToJsonSchema } from 'zod-to-json-schema';
import { configSchema } from '~/config/schema.ts';
import { frontmatterSchema } from '~/content/frontmatter-schema.ts';
import { themePackageJsonSchema } from '~/theme/pkg.ts';
import { CliUsageError, type ParsedCommand, formatCommandHelp, parseCommand } from '../parse.ts';
import { SCHEMA_SPEC } from '../specs.ts';

const SCHEMA_TARGETS = {
  config: {
    name: 'LaurelConfig',
    schema: configSchema,
    title: 'Laurel config schema',
  },
  frontmatter: {
    name: 'LaurelFrontmatter',
    schema: frontmatterSchema,
    title: 'Laurel frontmatter schema',
  },
  theme: {
    name: 'LaurelThemePackage',
    schema: themePackageJsonSchema,
    title: 'Laurel theme package.json schema',
  },
} as const;

type SchemaTarget = keyof typeof SCHEMA_TARGETS;

export async function runSchema(args: string[]): Promise<number> {
  let parsed: ParsedCommand;
  try {
    parsed = parseCommand(SCHEMA_SPEC, args, process.env);
  } catch (err) {
    if (err instanceof CliUsageError) {
      process.stderr.write(`${err.message}\n\n`);
      process.stderr.write(formatCommandHelp(SCHEMA_SPEC));
      return 2;
    }
    throw err;
  }
  if (parsed.helpRequested) {
    process.stdout.write(formatCommandHelp(SCHEMA_SPEC));
    return 0;
  }

  const target = parsed.positionals[0];
  if (!isSchemaTarget(target)) {
    process.stderr.write(
      `Unknown schema target: ${target ?? '<missing>'}. Expected config, frontmatter, or theme.\n`,
    );
    return 2;
  }

  const jsonSchema = buildJsonSchema(target);
  process.stdout.write(`${JSON.stringify(jsonSchema, null, 2)}\n`);
  return 0;
}

function buildJsonSchema(target: SchemaTarget): Record<string, unknown> {
  const spec = SCHEMA_TARGETS[target];
  const schema = zodToJsonSchema(spec.schema, {
    name: spec.name,
    $refStrategy: 'root',
    target: 'jsonSchema7',
  }) as Record<string, unknown>;
  return {
    title: spec.title,
    ...schema,
  };
}

function isSchemaTarget(value: string | undefined): value is SchemaTarget {
  return value === 'config' || value === 'frontmatter' || value === 'theme';
}
