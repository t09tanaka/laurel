import type { NectarConfig } from '~/config/schema.ts';
import { suggestClosest } from '~/util/errors.ts';
import { logger } from '~/util/logger.ts';
import type { ThemeCustomSettingDefinition, ThemePackage } from './types.ts';

export interface ThemeCustomIssue {
  key: string;
  suggestion?: string;
}

export interface ThemeCustomValueIssue {
  key: string;
  reason: string;
  suggestion?: string;
}

export interface ValidateThemeCustomOptions {
  config: NectarConfig;
  pkg: ThemePackage;
}

export interface ValidateThemeCustomResult {
  unknownKeys: ThemeCustomIssue[];
  invalidValues: ThemeCustomValueIssue[];
}

export function findUnknownThemeCustomKeys({
  config,
  pkg,
}: ValidateThemeCustomOptions): ThemeCustomIssue[] {
  const knownKeys = Object.keys(pkg.custom);
  // If the theme declares no custom schema, we have nothing to compare against.
  if (knownKeys.length === 0) return [];

  const issues: ThemeCustomIssue[] = [];
  for (const key of Object.keys(config.theme.custom)) {
    if (Object.prototype.hasOwnProperty.call(pkg.custom, key)) continue;
    const suggestion = suggestClosest(key, knownKeys);
    issues.push(suggestion ? { key, suggestion } : { key });
  }
  return issues;
}

export function findInvalidThemeCustomValues({
  config,
  pkg,
}: ValidateThemeCustomOptions): ThemeCustomValueIssue[] {
  const issues: ThemeCustomValueIssue[] = [];
  for (const [key, value] of Object.entries(config.theme.custom)) {
    const def = pkg.custom[key];
    if (!def) continue;
    const issue = checkValue(key, value, def);
    if (issue) issues.push(issue);
  }
  return issues;
}

export function validateThemeCustom(
  options: ValidateThemeCustomOptions,
): ValidateThemeCustomResult {
  const unknownKeys = findUnknownThemeCustomKeys(options);
  for (const issue of unknownKeys) {
    logger.warn(formatThemeCustomIssue(issue, options.pkg.name));
  }
  const invalidValues = findInvalidThemeCustomValues(options);
  for (const issue of invalidValues) {
    logger.warn(formatThemeCustomValueIssue(issue, options.pkg.name));
  }
  return { unknownKeys, invalidValues };
}

export function formatThemeCustomIssue(issue: ThemeCustomIssue, themeName: string): string {
  const head = `unknown \`[theme.custom].${issue.key}\` — not declared by theme "${themeName}"`;
  return issue.suggestion ? `${head} (did you mean \`${issue.suggestion}\`?)` : head;
}

export function formatThemeCustomValueIssue(
  issue: ThemeCustomValueIssue,
  themeName: string,
): string {
  const head = `invalid value for \`[theme.custom].${issue.key}\` in theme "${themeName}": ${issue.reason}`;
  return issue.suggestion ? `${head} (did you mean \`${issue.suggestion}\`?)` : head;
}

function checkValue(
  key: string,
  value: unknown,
  def: ThemeCustomSettingDefinition,
): ThemeCustomValueIssue | undefined {
  switch (def.type) {
    case 'select':
      return checkSelect(key, value, def.options ?? []);
    case 'boolean':
      return typeof value === 'boolean'
        ? undefined
        : { key, reason: `expected boolean, got ${describeValue(value)}` };
    case 'text':
      return typeof value === 'string'
        ? undefined
        : { key, reason: `expected string, got ${describeValue(value)}` };
    case 'color':
      return checkColor(key, value);
    case 'image':
      return typeof value === 'string'
        ? undefined
        : { key, reason: `expected image path string, got ${describeValue(value)}` };
  }
}

function checkSelect(
  key: string,
  value: unknown,
  options: readonly string[],
): ThemeCustomValueIssue | undefined {
  if (typeof value !== 'string') {
    return { key, reason: `expected string, got ${describeValue(value)}` };
  }
  if (options.length === 0) return undefined;
  if (options.includes(value)) return undefined;
  const formatted = options.map((o) => `\`${o}\``).join(', ');
  const reason = `\`${value}\` is not one of ${formatted}`;
  const suggestion = suggestClosest(value, options);
  return suggestion ? { key, reason, suggestion } : { key, reason };
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function checkColor(key: string, value: unknown): ThemeCustomValueIssue | undefined {
  if (typeof value !== 'string') {
    return { key, reason: `expected color string, got ${describeValue(value)}` };
  }
  if (!HEX_COLOR.test(value)) {
    return { key, reason: `\`${value}\` is not a valid hex color (e.g. \`#ffffff\`)` };
  }
  return undefined;
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'string') return `string \`${value as string}\``;
  if (t === 'number' || t === 'boolean') return `${t} \`${String(value)}\``;
  return t;
}
