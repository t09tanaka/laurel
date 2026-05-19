import type { NectarConfig } from '~/config/schema.ts';
import { suggestClosest } from '~/util/errors.ts';
import { logger } from '~/util/logger.ts';
import type { ThemePackage } from './types.ts';

export interface ThemeCustomIssue {
  key: string;
  suggestion?: string;
}

export interface ValidateThemeCustomOptions {
  config: NectarConfig;
  pkg: ThemePackage;
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

export function validateThemeCustom(options: ValidateThemeCustomOptions): ThemeCustomIssue[] {
  const issues = findUnknownThemeCustomKeys(options);
  for (const issue of issues) {
    logger.warn(formatThemeCustomIssue(issue, options.pkg.name));
  }
  return issues;
}

export function formatThemeCustomIssue(issue: ThemeCustomIssue, themeName: string): string {
  const head = `unknown \`[theme.custom].${issue.key}\` — not declared by theme "${themeName}"`;
  return issue.suggestion ? `${head} (did you mean \`${issue.suggestion}\`?)` : head;
}
