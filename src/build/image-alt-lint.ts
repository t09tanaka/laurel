import { Parser } from 'htmlparser2';

export type ImageAltLintIssue = 'missing-alt' | 'empty-alt';

export interface ImageAltLintWarning {
  issue: ImageAltLintIssue;
  outputPath: string;
  routeUrl: string;
  src?: string | undefined;
}

export interface ImageAltLintOptions {
  outputPath: string;
  routeUrl: string;
}

const DECORATIVE_ROLES = new Set(['none', 'presentation']);
const DECORATIVE_CLASS_NAMES = new Set(['kg-bookmark-icon', 'nectar-decorative']);

export function collectImageAltWarnings(
  html: string,
  { outputPath, routeUrl }: ImageAltLintOptions,
): ImageAltLintWarning[] {
  if (!html.includes('<img')) return [];
  const warnings: ImageAltLintWarning[] = [];

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name !== 'img') return;
        if (!Object.hasOwn(attrs, 'alt')) {
          warnings.push({
            issue: 'missing-alt',
            outputPath,
            routeUrl,
            src: normalizeSrc(attrs.src),
          });
          return;
        }
        const alt = attrs.alt ?? '';
        if (alt.trim().length === 0 && !isDecorativeImage(attrs)) {
          warnings.push({
            issue: 'empty-alt',
            outputPath,
            routeUrl,
            src: normalizeSrc(attrs.src),
          });
        }
      },
    },
    {
      decodeEntities: false,
      lowerCaseAttributeNames: true,
      lowerCaseTags: true,
      recognizeSelfClosing: true,
    },
  );

  parser.write(html);
  parser.end();
  return warnings;
}

export function formatImageAltWarning(warning: ImageAltLintWarning): string {
  const src = warning.src ? ` src=${JSON.stringify(warning.src)}` : '';
  const detail =
    warning.issue === 'missing-alt'
      ? 'is missing alt text'
      : 'has empty alt text but is not explicitly marked decorative';
  return `Image accessibility: ${warning.outputPath} (${warning.routeUrl}) <img${src}> ${detail}. Add meaningful alt text or mark decorative images with aria-hidden="true" or role="presentation".`;
}

function isDecorativeImage(attrs: Record<string, string>): boolean {
  const ariaHidden = attrs['aria-hidden']?.trim().toLowerCase();
  if (ariaHidden === 'true') return true;

  const role = attrs.role?.trim().toLowerCase();
  if (role && DECORATIVE_ROLES.has(role)) return true;

  for (const className of classNames(attrs.class)) {
    if (DECORATIVE_CLASS_NAMES.has(className)) return true;
  }

  return false;
}

function classNames(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\s+/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

function normalizeSrc(src: string | undefined): string | undefined {
  const value = src?.trim();
  return value && value.length > 0 ? value : undefined;
}
