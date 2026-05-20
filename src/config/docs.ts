import { resolve } from 'node:path';
import { z } from 'zod';
import { configSchema } from './schema.ts';

const AUTOGEN_BANNER =
  '<!-- AUTO-GENERATED FILE. Do not edit by hand. Regenerate with `bun run docs:config`. -->';

interface FieldDoc {
  path: string;
  type: string;
  required: boolean;
  defaultLiteral: string | null;
  description: string;
}

interface SectionDoc {
  path: string;
  description: string;
  fields: FieldDoc[];
  subsections: SectionDoc[];
}

export function renderConfigReference(schema: z.ZodTypeAny = configSchema): string {
  const root = describeRootObject(schema);
  const lines: string[] = [];

  lines.push('# Nectar configuration reference');
  lines.push('');
  lines.push(AUTOGEN_BANNER);
  lines.push('');
  lines.push(
    'This page lists every key understood by `nectar.toml`. It is generated from the',
    'Zod schema in `src/config/schema.ts`; run `bun run docs:config` after changing a',
    'field to refresh it.',
  );
  lines.push('');
  lines.push(
    'Every field is optional unless **Required** is marked `yes` — omitting a field',
    'falls back to the listed default.',
  );
  lines.push('');
  lines.push('## File discovery and precedence');
  lines.push('');
  lines.push(
    'When a caller does not provide an explicit config path, Nectar looks only in',
    'the current working directory. It checks `nectar.toml` first, then',
    '`nectar.config.toml`; the first existing file wins. If `NECTAR_ENV` is set,',
    'Nectar then appends `nectar.<env>.toml` when that file exists. If no config',
    'file exists, the schema defaults shown below are used.',
  );
  lines.push('');
  lines.push(
    'Passing `--config <path>` on the CLI, setting the command-specific config',
    'environment variable such as `NECTAR_BUILD_CONFIG`, or passing',
    '`configPath` to the build API disables discovery and `NECTAR_ENV` file',
    'selection. Repeat `--config` or comma-separate paths to load multiple files;',
    'later files deep-merge over earlier files, with arrays and scalar values',
    'replaced. Relative config paths are resolved from the command or API `cwd`.',
  );
  lines.push('');
  lines.push(
    'The value precedence for config-backed behaviour is: CLI flag, then',
    'command-specific env var, then config file, then schema default. Separately,',
    '`NECTAR_<SECTION>_<KEY>` environment variables override matching',
    '`nectar.toml` keys after the file is parsed, for example',
    '`NECTAR_SITE_URL=https://preview.example`. String, number, boolean, and',
    'array keys are coerced through the same schema parser as TOML config;',
    'primitive arrays may be comma-separated or JSON arrays, while object arrays',
    'must be JSON arrays.',
  );
  lines.push('');
  lines.push(
    'On Netlify `deploy-preview` and `branch-deploy` builds, `DEPLOY_PRIME_URL`',
    'is used as a `site.url` fallback when `NECTAR_SITE_URL` is unset; Nectar',
    'falls back to `DEPLOY_URL`, then `URL`. Build-level `--base-url` and',
    '`NECTAR_BUILD_BASE_URL` still override that loaded config value.',
  );
  lines.push('');
  lines.push(
    'On Vercel builds, `VERCEL_URL` is used as the same `site.url` fallback',
    'when `NECTAR_SITE_URL` is unset; host-only values are treated as HTTPS.',
    '`VERCEL_GIT_COMMIT_REF` and `VERCEL_GIT_COMMIT_SHA` are copied into',
    '`build.metadata` and surfaced to templates as `@site.build`.',
  );
  lines.push('');
  lines.push(
    'On Cloudflare Pages builds, `CF_PAGES_URL` is used as the same `site.url`',
    'fallback when `NECTAR_SITE_URL` is unset. `CF_PAGES_BRANCH` and',
    '`CF_PAGES_COMMIT_SHA` are also copied into `build.metadata` and surfaced to',
    'templates as `@site.build`.',
  );
  lines.push('');
  lines.push(
    'Most relative project paths in the config, including `theme.dir` and the',
    '`content.*_dir` fields, are anchored to the directory containing the loaded',
    'config file when that file is outside `cwd`. `build.output_dir` is the',
    'notable exception: it remains relative to the project root / build `cwd` and',
    'must stay inside that root.',
  );
  lines.push('');

  lines.push('## Top-level keys');
  lines.push('');
  lines.push(
    ...renderTable(
      ['Key', 'Type', 'Description'],
      [
        ...root.subsections.map((s) => [
          code(s.path),
          renderSubsectionTypeLabel(s),
          s.description || '—',
        ]),
        ...root.fields.map((f) => [code(f.path), code(f.type), f.description || '—']),
      ],
    ),
  );
  lines.push('');

  // Render top-level scalar / primitive-array fields in a dedicated table so
  // their descriptions show up under the rule "every described field appears
  // with its description" (docs.test.ts). Without this they would only be
  // listed in the summary table above.
  if (root.fields.length > 0) {
    lines.push('## Top-level fields');
    lines.push('');
    lines.push(
      ...renderTable(
        ['Key', 'Type', 'Required', 'Default', 'Description'],
        root.fields.map((f) => [
          code(f.path),
          code(f.type),
          f.required ? 'yes' : 'no',
          f.defaultLiteral === null ? '—' : code(f.defaultLiteral),
          f.description || '—',
        ]),
      ),
    );
    lines.push('');
  }

  for (const section of root.subsections) {
    lines.push(...renderSection(section));
    lines.push('');
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  lines.push('');
  return lines.join('\n');
}

function describeRootObject(schema: z.ZodTypeAny): SectionDoc {
  const inner = unwrap(schema).schema;
  if (!(inner instanceof z.ZodObject)) {
    throw new Error('renderConfigReference expects an object schema at the root.');
  }
  return describeObject('', inner, schema._def.description ?? '');
}

function describeObject(
  path: string,
  schema: z.ZodObject<z.ZodRawShape>,
  description: string,
): SectionDoc {
  const fields: FieldDoc[] = [];
  const subsections: SectionDoc[] = [];
  const shape = schema.shape;

  for (const [key, child] of Object.entries(shape)) {
    const childPath = path ? `${path}.${key}` : key;
    const { schema: bare, required, defaultLiteral, description: childDesc } = unwrap(child);

    if (bare instanceof z.ZodObject) {
      subsections.push(describeObject(childPath, bare, childDesc));
      continue;
    }

    if (bare instanceof z.ZodArray) {
      const element = unwrap(bare._def.type).schema;
      if (element instanceof z.ZodObject) {
        const sub = describeObject(`${childPath}[]`, element, childDesc);
        sub.description = childDesc;
        subsections.push(sub);
        continue;
      }
    }

    fields.push({
      path: childPath,
      type: typeLabel(bare),
      required,
      defaultLiteral,
      description: childDesc,
    });
  }

  return {
    path,
    description,
    fields,
    subsections,
  };
}

function renderSection(section: SectionDoc): string[] {
  const lines: string[] = [];
  const heading = section.path ? `## \`${section.path}\`` : '## Root';
  lines.push(heading);
  lines.push('');
  if (section.description) {
    lines.push(section.description);
    lines.push('');
  }

  if (section.fields.length > 0) {
    lines.push(
      ...renderTable(
        ['Key', 'Type', 'Required', 'Default', 'Description'],
        section.fields.map((f) => [
          code(f.path),
          code(f.type),
          f.required ? 'yes' : 'no',
          f.defaultLiteral === null ? '—' : code(f.defaultLiteral),
          f.description || '—',
        ]),
      ),
    );
  }

  for (const sub of section.subsections) {
    lines.push('');
    lines.push(...renderSection(sub));
  }

  return lines;
}

function renderSubsectionTypeLabel(section: SectionDoc): string {
  if (section.path.endsWith('[]')) return code('array<object>');
  return code('object');
}

interface Unwrapped {
  schema: z.ZodTypeAny;
  required: boolean;
  defaultLiteral: string | null;
  description: string;
}

function unwrap(schema: z.ZodTypeAny): Unwrapped {
  let current: z.ZodTypeAny = schema;
  let required = true;
  let defaultLiteral: string | null = null;
  const descriptions: string[] = [];

  while (true) {
    if (current.description) descriptions.push(current.description);

    if (current instanceof z.ZodOptional) {
      required = false;
      current = current._def.innerType;
      continue;
    }
    if (current instanceof z.ZodNullable) {
      required = false;
      current = current._def.innerType;
      continue;
    }
    if (current instanceof z.ZodDefault) {
      required = false;
      if (defaultLiteral === null) {
        const value = current._def.defaultValue();
        defaultLiteral = formatDefault(value);
      }
      current = current._def.innerType;
      continue;
    }
    if (current instanceof z.ZodEffects) {
      current = current._def.schema;
      continue;
    }
    break;
  }

  return {
    schema: current,
    required,
    defaultLiteral,
    description: descriptions[0] ?? '',
  };
}

function typeLabel(schema: z.ZodTypeAny): string {
  if (schema instanceof z.ZodString) return 'string';
  if (schema instanceof z.ZodNumber) return 'number';
  if (schema instanceof z.ZodBoolean) return 'boolean';
  if (schema instanceof z.ZodEnum) {
    const values: readonly string[] = schema._def.values;
    return values.map((v) => `"${v}"`).join(' | ');
  }
  if (schema instanceof z.ZodLiteral) {
    return JSON.stringify(schema._def.value);
  }
  if (schema instanceof z.ZodArray) {
    return `array<${typeLabel(unwrap(schema._def.type).schema)}>`;
  }
  if (schema instanceof z.ZodRecord) {
    const valueSchema = unwrap(schema._def.valueType).schema;
    return `record<string, ${typeLabel(valueSchema)}>`;
  }
  if (schema instanceof z.ZodObject) return 'object';
  if (schema instanceof z.ZodUnknown) return 'unknown';
  if (schema instanceof z.ZodAny) return 'any';
  if (schema instanceof z.ZodUnion) {
    const opts = schema._def.options as z.ZodTypeAny[];
    return opts.map((o) => typeLabel(unwrap(o).schema)).join(' | ');
  }
  return 'unknown';
}

function formatDefault(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return JSON.stringify(value);
  }
  if (typeof value === 'object') {
    if (Object.keys(value as Record<string, unknown>).length === 0) return '{}';
    return JSON.stringify(value);
  }
  return String(value);
}

function renderTable(headers: string[], rows: string[][]): string[] {
  const lines: string[] = [];
  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(`| ${row.map(escapeCell).join(' | ')} |`);
  }
  return lines;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function code(text: string): string {
  return `\`${text}\``;
}

if (import.meta.main) {
  const target = resolve(import.meta.dir, '../../docs/config.md');
  const markdown = renderConfigReference();
  await Bun.write(target, markdown);
  process.stdout.write(`Wrote ${target}\n`);
}
