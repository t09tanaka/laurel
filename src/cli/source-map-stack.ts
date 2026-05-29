import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface RawSourceMap {
  version: number;
  sources: string[];
  sourceRoot?: string;
  mappings: string;
}

interface MappingSegment {
  generatedColumn: number;
  sourceIndex: number;
  originalLine: number;
  originalColumn: number;
}

interface ParsedSourceMap {
  mapPath: string;
  sourceRoot: string | undefined;
  sources: string[];
  lines: MappingSegment[][];
}

interface SourcePosition {
  file: string;
  line: number;
  column: number;
}

let installed = false;
const maps = new Map<string, ParsedSourceMap | null>();
const base64Values = buildBase64Values();

export function installSourceMapStackTraceSupport(): void {
  if (installed) return;
  installed = true;

  const previous = Error.prepareStackTrace;
  Error.prepareStackTrace = (err, stack) => {
    const formatted = formatMappedStack(err, stack);
    if (formatted !== null) return formatted;
    if (previous) return previous(err, stack);
    return formatStack(err, stack, false);
  };
}

export function resolveSourcePosition(
  generatedFile: string | null | undefined,
  generatedLine: number | null | undefined,
  generatedColumn: number | null | undefined,
): SourcePosition | null {
  if (!generatedFile || generatedLine === null || generatedLine === undefined) return null;
  if (generatedColumn === null || generatedColumn === undefined) return null;
  const map = loadSourceMap(generatedFile);
  if (!map) return null;
  const line = map.lines[generatedLine - 1];
  if (!line || line.length === 0) return null;
  const generatedColumnZeroBased = Math.max(0, generatedColumn - 1);
  let match: MappingSegment | undefined;
  for (const segment of line) {
    if (segment.generatedColumn > generatedColumnZeroBased) break;
    match = segment;
  }
  if (!match) return null;
  const source = map.sources[match.sourceIndex];
  if (!source) return null;
  return {
    file: resolveSourcePath(map.mapPath, map.sourceRoot, source),
    line: match.originalLine + 1,
    column: match.originalColumn + 1,
  };
}

function formatMappedStack(err: Error, stack: NodeJS.CallSite[]): string | null {
  const mapped = stack.some((site) =>
    resolveSourcePosition(site.getFileName(), site.getLineNumber(), site.getColumnNumber()),
  );
  if (!mapped) return null;
  return formatStack(err, stack, true);
}

function formatStack(err: Error, stack: NodeJS.CallSite[], mapFrames: boolean): string {
  const header =
    err.name && err.message ? `${err.name}: ${err.message}` : err.message || err.name || 'Error';
  const frames = stack.map((site) => formatCallSite(site, mapFrames));
  return [header, ...frames].join('\n');
}

function formatCallSite(site: NodeJS.CallSite, mapFrame: boolean): string {
  const location = formatLocation(site, mapFrame);
  const functionName = site.getFunctionName();
  const methodName = site.getMethodName();
  const typeName = site.getTypeName();

  if (site.isConstructor()) return `    at new ${functionName ?? '<anonymous>'} (${location})`;
  if (functionName) return `    at ${functionName} (${location})`;
  if (typeName && methodName) return `    at ${typeName}.${methodName} (${location})`;
  return `    at ${location}`;
}

function formatLocation(site: NodeJS.CallSite, mapFrame: boolean): string {
  if (site.isNative()) return 'native';
  const file = site.getFileName() ?? site.getScriptNameOrSourceURL();
  const line = site.getLineNumber();
  const column = site.getColumnNumber();
  const mapped = mapFrame ? resolveSourcePosition(file, line, column) : null;
  if (mapped) return `${mapped.file}:${mapped.line}:${mapped.column}`;
  if (!file) return '<anonymous>';
  if (line === null || line === undefined) return file;
  if (column === null || column === undefined) return `${file}:${line}`;
  return `${file}:${line}:${column}`;
}

function loadSourceMap(generatedFile: string): ParsedSourceMap | null {
  const normalized = normalize(generatedFile);
  if (maps.has(normalized)) return maps.get(normalized) ?? null;

  try {
    const mapPath = resolveSourceMapPath(normalized);
    if (!mapPath) {
      maps.set(normalized, null);
      return null;
    }
    const raw = JSON.parse(readFileSync(mapPath, 'utf8')) as RawSourceMap;
    if (raw.version !== 3 || !Array.isArray(raw.sources) || typeof raw.mappings !== 'string') {
      maps.set(normalized, null);
      return null;
    }
    const parsed: ParsedSourceMap = {
      mapPath,
      sourceRoot: typeof raw.sourceRoot === 'string' ? raw.sourceRoot : undefined,
      sources: raw.sources,
      lines: parseMappings(raw.mappings),
    };
    maps.set(normalized, parsed);
    return parsed;
  } catch {
    maps.set(normalized, null);
    return null;
  }
}

function resolveSourceMapPath(generatedFile: string): string | null {
  const adjacent = `${generatedFile}.map`;
  if (existsSync(adjacent)) return adjacent;

  let source: string;
  try {
    source = readFileSync(generatedFile, 'utf8');
  } catch {
    return null;
  }
  const match = /\/\/# sourceMappingURL=(\S+)\s*$/.exec(source);
  if (!match) return null;
  const value = match[1];
  if (value === undefined) return null;
  if (value.startsWith('data:')) return null;
  if (value.startsWith('file://')) return fileURLToPath(value);
  return isAbsolute(value) ? value : resolve(dirname(generatedFile), value);
}

function parseMappings(mappings: string): MappingSegment[][] {
  const lines: MappingSegment[][] = [];
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;

  for (const line of mappings.split(';')) {
    const segments: MappingSegment[] = [];
    let generatedColumn = 0;
    for (const rawSegment of line.split(',')) {
      if (rawSegment === '') continue;
      const values = decodeVlqSegment(rawSegment);
      generatedColumn += values[0] ?? 0;
      if (values.length < 4) continue;
      sourceIndex += values[1] ?? 0;
      originalLine += values[2] ?? 0;
      originalColumn += values[3] ?? 0;
      segments.push({ generatedColumn, sourceIndex, originalLine, originalColumn });
    }
    lines.push(segments);
  }
  return lines;
}

function decodeVlqSegment(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;

  for (const char of segment) {
    const integer = base64Values.get(char);
    if (integer === undefined) throw new Error(`Invalid source map VLQ character: ${char}`);
    const digit = integer & 31;
    const continuation = (integer & 32) !== 0;
    value += digit << shift;
    if (continuation) {
      shift += 5;
      continue;
    }
    values.push(fromVlqSigned(value));
    value = 0;
    shift = 0;
  }

  return values;
}

function fromVlqSigned(value: number): number {
  const negative = (value & 1) === 1;
  const shifted = value >> 1;
  return negative ? -shifted : shifted;
}

function resolveSourcePath(
  mapPath: string,
  sourceRoot: string | undefined,
  source: string,
): string {
  if (source.startsWith('file://')) return fileURLToPath(source);
  if (isAbsolute(source)) return normalize(source);
  if (!sourceRoot) return resolve(dirname(mapPath), source);
  if (sourceRoot.startsWith('file://')) return resolve(fileURLToPath(sourceRoot), source);
  if (isAbsolute(sourceRoot)) return resolve(sourceRoot, source);
  return resolve(dirname(mapPath), sourceRoot, source);
}

function buildBase64Values(): Map<string, number> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  return new Map([...chars].map((char, index) => [char, index]));
}
