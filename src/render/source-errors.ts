import { join } from 'node:path';
import type Handlebars from 'handlebars';
import type { ThemeBundle } from '~/theme/types.ts';
import { LaurelError, isLaurelError } from '~/util/errors.ts';

const SOURCE_STACK_KEY = '__laurelSourceStack';

interface ThemeSourceInfo {
  file: string;
  kind: 'template' | 'layout' | 'partial' | 'template-partial';
  name: string;
  source: string;
  sourceOffset?: number;
}

interface SourceLocation {
  line: number;
  col?: number;
}

interface HelperOptionsLike {
  data?: Record<string, unknown>;
  loc?: {
    start?: {
      line?: unknown;
      column?: unknown;
    };
  };
}

type RegisterHelper = typeof Handlebars.registerHelper;

export function compileThemeSource(
  hb: typeof Handlebars,
  source: string,
  info: Omit<ThemeSourceInfo, 'source'>,
): Handlebars.TemplateDelegate {
  const delegate = hb.compile(source);
  return wrapTemplateDelegate(delegate, { ...info, source });
}

export function registerThemePartial(
  hb: typeof Handlebars,
  name: string,
  source: string,
  info: Omit<ThemeSourceInfo, 'source'>,
): void {
  hb.registerPartial(name, compileThemeSource(hb, source, info));
}

export function installSourceAwareHelperErrors(hb: typeof Handlebars): void {
  const registerHelper = hb.registerHelper.bind(hb) as RegisterHelper;
  hb.registerHelper = ((
    nameOrMap: string | Record<string, Handlebars.HelperDelegate>,
    fn?: unknown,
  ) => {
    if (typeof nameOrMap === 'string') {
      if (typeof fn === 'function') {
        registerHelper(nameOrMap, wrapHelper(nameOrMap, fn as Handlebars.HelperDelegate));
        return;
      }
      registerHelper(nameOrMap, fn as Handlebars.HelperDelegate);
      return;
    }

    const wrapped: Record<string, Handlebars.HelperDelegate> = {};
    for (const [name, helper] of Object.entries(nameOrMap)) {
      wrapped[name] = wrapHelper(name, helper);
    }
    registerHelper(wrapped);
  }) as RegisterHelper;
}

export function templateSourceInfo(
  theme: ThemeBundle,
  name: string,
  sourceOffset = 0,
): Omit<ThemeSourceInfo, 'source'> {
  return {
    file: join(theme.rootDir, `${name}.hbs`),
    kind: 'template',
    name,
    sourceOffset,
  };
}

export function layoutSourceInfo(
  theme: ThemeBundle,
  name: string,
): Omit<ThemeSourceInfo, 'source'> {
  return {
    file: join(theme.rootDir, `${name}.hbs`),
    kind: 'layout',
    name,
  };
}

export function partialSourceInfo(
  theme: ThemeBundle,
  name: string,
): Omit<ThemeSourceInfo, 'source'> {
  return {
    file: join(theme.rootDir, 'partials', `${name}.hbs`),
    kind: 'partial',
    name,
  };
}

export function templatePartialSourceInfo(
  theme: ThemeBundle,
  name: string,
  sourceOffset = 0,
): Omit<ThemeSourceInfo, 'source'> {
  return {
    file: join(theme.rootDir, `${name}.hbs`),
    kind: 'template-partial',
    name,
    sourceOffset,
  };
}

export function handlebarsLocationFromError(
  err: unknown,
  source: string,
  sourceOffset = 0,
): SourceLocation | undefined {
  const message = err instanceof Error ? err.message : String(err);
  const line = parseHandlebarsLine(message);
  if (line === undefined) return undefined;

  const sourceLine = lineText(source, line);
  const col = parseCaretColumn(message, sourceLine);
  return offsetLocation(source, sourceOffset, { line, col });
}

function wrapTemplateDelegate(
  delegate: Handlebars.TemplateDelegate,
  info: ThemeSourceInfo,
): Handlebars.TemplateDelegate {
  const wrapped = ((context: unknown, options?: RuntimeOptionsWithData) => {
    const data = options?.data;
    const previous = getSourceStack(data);
    setSourceStack(data, [...previous, info]);
    try {
      return delegate(context, options);
    } catch (err) {
      throw toThemeSourceError(err, info);
    } finally {
      setSourceStack(data, previous);
    }
  }) as Handlebars.TemplateDelegate;
  Object.defineProperty(wrapped, '__laurelSource', {
    value: info.source,
    enumerable: false,
  });
  return wrapped;
}

function wrapHelper(name: string, helper: Handlebars.HelperDelegate): Handlebars.HelperDelegate {
  return function sourceAwareHelper(this: unknown, ...args: unknown[]) {
    try {
      return helper.apply(this, args as Parameters<Handlebars.HelperDelegate>);
    } catch (err) {
      const options = args[args.length - 1] as HelperOptionsLike | undefined;
      const frame = currentSourceFrame(options?.data);
      if (frame === undefined) throw err;
      const loc = helperLocation(options);
      throw toThemeSourceError(err, frame, {
        messagePrefix: `Handlebars helper '${name}' failed`,
        loc,
      });
    }
  };
}

function toThemeSourceError(
  err: unknown,
  info: ThemeSourceInfo,
  opts: { messagePrefix?: string; loc?: SourceLocation } = {},
): LaurelError {
  if (isLaurelError(err)) {
    if (err.file !== undefined) return err;
    return new LaurelError({
      message: err.message,
      file: info.file,
      line: opts.loc?.line,
      col: opts.loc?.col,
      hint: err.hint,
      docsUrl: err.docsUrl,
      cause: err.cause ?? err,
      code: err.code ?? 'theme',
    });
  }

  const rawMessage = err instanceof Error ? err.message : String(err);
  const loc =
    opts.loc ??
    missingPartialLocation(rawMessage, info) ??
    handlebarsLocationFromError(err, info.source, info.sourceOffset);
  const sourceLine = loc?.line === undefined ? undefined : lineTextAtFileLine(info, loc.line);
  const context = sourceLine === undefined ? '' : ` — ${sourceLine.trim()}`;
  const prefix = opts.messagePrefix ?? messagePrefixFor(info);
  const message = sourceErrorMessage(prefix, rawMessage, context);
  return new LaurelError({
    message,
    file: info.file,
    line: loc?.line,
    col: loc?.col,
    hint: hintFor(rawMessage),
    docsUrl: 'docs/THEME_DEV.md',
    cause: err,
    code: 'theme',
  });
}

function sourceErrorMessage(prefix: string, rawMessage: string, context: string): string {
  const partialName = missingPartialName(rawMessage);
  if (partialName !== undefined && hasParentPathSegment(partialName)) {
    return `Unsupported partial include '${partialName}': partial names are rooted at partials/ and cannot use ../ parent segments${context}`;
  }
  return `${prefix}: ${rawMessage}${context}`;
}

function messagePrefixFor(info: ThemeSourceInfo): string {
  if (info.kind === 'partial') return `Theme partial '${info.name}' failed`;
  if (info.kind === 'template-partial') return `Theme template partial '${info.name}' failed`;
  return `Theme ${info.kind} '${info.name}' failed`;
}

function hintFor(message: string): string | undefined {
  const partialName = missingPartialName(message);
  if (partialName === undefined) return undefined;
  if (hasParentPathSegment(partialName)) {
    return 'Partial includes are rooted at the active theme partials/ directory and cannot use ../ parent segments. Move shared files under partials/ and include them by name, for example {{> "components/header"}}.';
  }
  return `Check that partials/${partialName}.hbs exists in the active theme, or update the partial include to an existing partial name.`;
}

function missingPartialLocation(
  message: string,
  info: ThemeSourceInfo,
): SourceLocation | undefined {
  const partialName = missingPartialName(message);
  if (partialName === undefined) return undefined;
  const escaped = partialName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\{\\{>\\s*(?:"${escaped}"|'${escaped}'|${escaped})(?:\\s|\\}|/)`);
  const match = pattern.exec(info.source);
  if (!match || match.index === undefined) return undefined;
  const loc = locationAtOffset(info.source, match.index + (match[0].indexOf(partialName) ?? 0));
  return offsetLocation(info.source, info.sourceOffset ?? 0, loc);
}

function missingPartialName(message: string): string | undefined {
  const match = /^The partial (.+) could not be found$/.exec(message);
  return match?.[1];
}

function hasParentPathSegment(name: string): boolean {
  return name.split(/[\\/]+/).includes('..');
}

function helperLocation(options: HelperOptionsLike | undefined): SourceLocation | undefined {
  const line = options?.loc?.start?.line;
  const column = options?.loc?.start?.column;
  if (typeof line !== 'number') return undefined;
  return {
    line,
    col: typeof column === 'number' ? column + 1 : undefined,
  };
}

function currentSourceFrame(
  data: Record<string, unknown> | undefined,
): ThemeSourceInfo | undefined {
  const stack = getSourceStack(data);
  return stack[stack.length - 1];
}

function getSourceStack(data: Record<string, unknown> | undefined): ThemeSourceInfo[] {
  const value = data?.[SOURCE_STACK_KEY];
  return Array.isArray(value) ? (value as ThemeSourceInfo[]) : [];
}

function setSourceStack(data: Record<string, unknown> | undefined, stack: ThemeSourceInfo[]): void {
  if (data === undefined) return;
  if (stack.length === 0) delete data[SOURCE_STACK_KEY];
  else data[SOURCE_STACK_KEY] = stack;
}

function parseHandlebarsLine(message: string): number | undefined {
  const match = /Parse error on line (\d+):/.exec(message);
  if (!match) return undefined;
  const line = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(line) ? line : undefined;
}

function parseCaretColumn(message: string, sourceLine: string | undefined): number | undefined {
  const lines = message.split(/\r?\n/);
  const caretLine = lines.find((line) => /^-+\^$/.test(line));
  if (caretLine === undefined) return undefined;
  const col = caretLine.indexOf('^') + 1;
  if (sourceLine === undefined) return col;
  return Math.min(col, sourceLine.length + 1);
}

function offsetLocation(
  source: string,
  offset: number | undefined,
  loc: SourceLocation,
): SourceLocation {
  if (!offset) return loc;
  const prefix = source.slice(0, offset);
  const lines = prefix.split(/\r\n|\n|\r/);
  const lineOffset = lines.length - 1;
  const lastPrefixLine = lines[lines.length - 1] ?? '';
  return {
    line: loc.line + lineOffset,
    col: loc.line === 1 && loc.col !== undefined ? loc.col + lastPrefixLine.length : loc.col,
  };
}

function locationAtOffset(source: string, offset: number): SourceLocation {
  const prefix = source.slice(0, offset);
  const lines = prefix.split(/\r\n|\n|\r/);
  const last = lines[lines.length - 1] ?? '';
  return {
    line: lines.length,
    col: last.length + 1,
  };
}

function lineText(source: string, line: number): string | undefined {
  return source.split(/\r\n|\n|\r/)[line - 1];
}

function lineTextAtFileLine(info: ThemeSourceInfo, fileLine: number): string | undefined {
  const loc = offsetLocation(info.source, info.sourceOffset ?? 0, { line: 1, col: 1 });
  const sourceLine = fileLine - loc.line + 1;
  if (sourceLine < 1) return undefined;
  return lineText(info.source, sourceLine);
}

interface RuntimeOptionsWithData {
  data?: Record<string, unknown>;
}
