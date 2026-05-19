import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { NectarError } from '~/util/errors.ts';
import { logger } from '~/util/logger.ts';
import type { ThemeCustomSettingDefinition, ThemeImageSize, ThemePackage } from './types.ts';

const CUSTOM_TYPES = ['text', 'select', 'boolean', 'color', 'image'] as const;
type CustomType = (typeof CUSTOM_TYPES)[number];

const imageSizeSchema: z.ZodType<ThemeImageSize> = z
  .object({
    width: z.number().optional(),
    height: z.number().optional(),
  })
  .passthrough();

// Anything we cannot positively identify as a known custom type is dropped.
// `unknown()` keeps the per-key entry around long enough for us to inspect
// `type` ourselves and either coerce or skip it — `z.discriminatedUnion`
// would reject the whole pkg if a single def used a stray type, which is too
// brittle for real-world themes that we don't control.
const customDefSchema = z.unknown();

const rawPkgSchema = z
  .object({
    name: z.string().optional(),
    version: z.string().optional(),
    config: z
      .object({
        posts_per_page: z.number().optional(),
        image_sizes: z.record(imageSizeSchema).optional(),
        card_assets: z.union([z.boolean(), z.array(z.string())]).optional(),
        custom: z.record(customDefSchema).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export async function loadThemePackage(rootDir: string): Promise<ThemePackage> {
  const path = join(rootDir, 'package.json');
  if (!existsSync(path)) {
    return defaultPackage();
  }
  const raw = await readFile(path, 'utf8');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new NectarError({
      message: `invalid theme package.json at ${path}: ${err instanceof Error ? err.message : String(err)}`,
      file: path,
      cause: err,
      code: 'theme',
    });
  }
  const result = rawPkgSchema.safeParse(json);
  if (!result.success) {
    logger.warn(
      `theme package.json at ${path} does not match expected shape; falling back to defaults`,
    );
    return defaultPackage();
  }
  const parsed = result.data;
  const cfg = parsed.config ?? {};
  const { custom, customDefaults } = normalizeCustom(cfg.custom ?? {}, parsed.name ?? 'theme');
  return {
    name: parsed.name ?? 'theme',
    version: parsed.version ?? '0.0.0',
    posts_per_page: cfg.posts_per_page ?? 5,
    image_sizes: cfg.image_sizes ?? {},
    card_assets: Boolean(cfg.card_assets),
    custom,
    customDefaults,
  };
}

// Trust nothing from package.json: an attacker (or careless theme author) can
// declare a custom setting whose default is e.g. `"</style><script>...</script>"`
// or a non-string for a `text` slot. Those defaults flow into `{{@custom.*}}`,
// which themes regularly inline into `<style>` blocks and inline scripts (see
// Source theme's `--background-color: {{@custom.site_background_color}}`).
// HTML-escape alone is not enough in those contexts. We whitelist types and
// coerce each default into a shape that matches the declared type.
function normalizeCustom(
  rawCustom: Record<string, unknown>,
  themeName: string,
): {
  custom: Record<string, ThemeCustomSettingDefinition>;
  customDefaults: Record<string, unknown>;
} {
  const custom: Record<string, ThemeCustomSettingDefinition> = {};
  const customDefaults: Record<string, unknown> = {};
  for (const [key, rawDef] of Object.entries(rawCustom)) {
    const normalized = normalizeCustomDef(key, rawDef, themeName);
    if (!normalized) continue;
    custom[key] = normalized.def;
    customDefaults[key] = normalized.default;
  }
  return { custom, customDefaults };
}

function normalizeCustomDef(
  key: string,
  rawDef: unknown,
  themeName: string,
): { def: ThemeCustomSettingDefinition; default: unknown } | undefined {
  if (!rawDef || typeof rawDef !== 'object') {
    logger.warn(`theme "${themeName}" custom setting \`${key}\` is not an object; skipping`);
    return undefined;
  }
  const obj = rawDef as Record<string, unknown>;
  const type = obj.type;
  if (typeof type !== 'string' || !isCustomType(type)) {
    logger.warn(
      `theme "${themeName}" custom setting \`${key}\` has unsupported type \`${String(type)}\`; skipping`,
    );
    return undefined;
  }
  const def: ThemeCustomSettingDefinition = { type };
  if (type === 'select') {
    const options = Array.isArray(obj.options)
      ? obj.options.filter((o): o is string => typeof o === 'string')
      : [];
    def.options = options;
  }
  if (typeof obj.description === 'string') def.description = obj.description;
  if (typeof obj.group === 'string') def.group = obj.group;
  if (typeof obj.visibility === 'string') def.visibility = obj.visibility;
  const coerced = coerceDefault(type, obj.default, def.options ?? []);
  if (Object.prototype.hasOwnProperty.call(obj, 'default')) {
    def.default = coerced;
  }
  return { def, default: coerced };
}

function isCustomType(type: string): type is CustomType {
  return (CUSTOM_TYPES as readonly string[]).includes(type);
}

function coerceDefault(type: CustomType, raw: unknown, options: readonly string[]): unknown {
  switch (type) {
    case 'boolean':
      return typeof raw === 'boolean' ? raw : false;
    case 'select':
      if (typeof raw === 'string' && (options.length === 0 || options.includes(raw))) {
        return raw;
      }
      return options[0] ?? '';
    case 'text':
    case 'image':
      return typeof raw === 'string' ? raw : '';
    case 'color':
      // Final color-context sanitization happens at render time in
      // sanitizeThemeCustomValues; here we just guarantee a string.
      return typeof raw === 'string' ? raw : '';
  }
}

function defaultPackage(): ThemePackage {
  return {
    name: 'theme',
    version: '0.0.0',
    posts_per_page: 5,
    image_sizes: {},
    card_assets: false,
    custom: {},
    customDefaults: {},
  };
}
