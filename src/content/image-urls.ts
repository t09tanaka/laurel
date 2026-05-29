import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import renderHtml from 'dom-serializer';
import type { ChildNode, Element } from 'domhandler';
import { parseDocument } from 'htmlparser2';

interface RewriteRelativeImageUrlsOptions {
  cwd: string;
  sourcePath: string;
  assetsDir: string;
}

const IMAGE_SRC_ATTRS = new Set(['data-src', 'src']);
const IMAGE_SRCSET_ATTRS = new Set(['data-srcset', 'srcset']);

export function rewriteRelativeImageUrls(
  html: string,
  opts: RewriteRelativeImageUrlsOptions,
): string {
  if (!html.includes('<') || !/\b(?:data-src|data-srcset|src|srcset)\s*=/i.test(html)) {
    return html;
  }

  const doc = parseDocument(html, {
    decodeEntities: false,
    lowerCaseAttributeNames: false,
  });
  const changed = rewriteRelativeImageUrlsInNodes(doc.children, opts);
  if (!changed) return html;
  return renderHtml(doc.children, { decodeEntities: false });
}

function rewriteRelativeImageUrlsInNodes(
  nodes: ChildNode[],
  opts: RewriteRelativeImageUrlsOptions,
): boolean {
  let changed = false;
  for (const node of nodes) {
    if (!isElement(node)) continue;
    changed = rewriteRelativeImageUrlsInElement(node, opts) || changed;
    changed = rewriteRelativeImageUrlsInNodes(node.children, opts) || changed;
  }
  return changed;
}

function rewriteRelativeImageUrlsInElement(
  node: Element,
  opts: RewriteRelativeImageUrlsOptions,
): boolean {
  if (!isImageCarrier(node)) return false;

  let changed = false;
  for (const [name, value] of Object.entries(node.attribs)) {
    const lower = name.toLowerCase();
    if (IMAGE_SRC_ATTRS.has(lower)) {
      const next = rewriteSingleImageUrl(value, opts);
      if (next !== value) {
        node.attribs[name] = next;
        changed = true;
      }
    } else if (IMAGE_SRCSET_ATTRS.has(lower)) {
      const next = rewriteImageSrcset(value, opts);
      if (next !== value) {
        node.attribs[name] = next;
        changed = true;
      }
    }
  }
  return changed;
}

function isImageCarrier(node: Element): boolean {
  const name = node.name.toLowerCase();
  return name === 'img' || name === 'source';
}

function rewriteImageSrcset(value: string, opts: RewriteRelativeImageUrlsOptions): string {
  let changed = false;
  const rewritten = value
    .split(',')
    .map((candidate) => {
      const leading = candidate.match(/^\s*/)?.[0] ?? '';
      const trailing = candidate.match(/\s*$/)?.[0] ?? '';
      const core = candidate.trim();
      if (!core) return candidate;
      const firstWs = core.search(/\s/);
      const url = firstWs === -1 ? core : core.slice(0, firstWs);
      const descriptor = firstWs === -1 ? '' : core.slice(firstWs).trim();
      const next = rewriteSingleImageUrl(url, opts);
      if (next === url) return candidate;
      changed = true;
      return `${leading}${next}${descriptor ? ` ${descriptor}` : ''}${trailing}`;
    })
    .join(',');
  return changed ? rewritten : value;
}

function rewriteSingleImageUrl(value: string, opts: RewriteRelativeImageUrlsOptions): string {
  const leading = value.match(/^\s*/)?.[0] ?? '';
  const trailing = value.match(/\s*$/)?.[0] ?? '';
  const core = value.slice(leading.length, value.length - trailing.length);
  if (!isRelativeImageUrl(core)) return value;

  const { path, suffix } = splitUrlSuffix(core);
  const publicPath = publicContentImagePath(path, opts);
  return publicPath ? `${leading}${publicPath}${suffix}${trailing}` : value;
}

function isRelativeImageUrl(value: string): boolean {
  if (!value || value.startsWith('#') || value.startsWith('/') || value.startsWith('//')) {
    return false;
  }
  return !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

function splitUrlSuffix(value: string): { path: string; suffix: string } {
  const idx = value.search(/[?#]/);
  if (idx === -1) return { path: value, suffix: '' };
  return { path: value.slice(0, idx), suffix: value.slice(idx) };
}

function publicContentImagePath(
  rawPath: string,
  opts: RewriteRelativeImageUrlsOptions,
): string | undefined {
  const path = rawPath.replaceAll('\\', '/');
  if (!path || path.includes('\0')) return undefined;

  const assetsRoot = resolve(opts.cwd, opts.assetsDir);
  const resolved = resolve(dirname(opts.sourcePath), path);
  const resolvedRel = relative(assetsRoot, resolved);
  if (!resolvedRel.startsWith('..') && !isAbsolute(resolvedRel)) {
    return toContentImagesUrl(resolvedRel);
  }

  const fromAssetsDir = stripLeadingPathPrefix(path, normalizeUrlPath(opts.assetsDir));
  if (fromAssetsDir) return toContentImagesUrl(fromAssetsDir);

  const fromAssetsBasename = stripLeadingPathPrefix(path, lastPathSegment(opts.assetsDir));
  if (fromAssetsBasename) return toContentImagesUrl(fromAssetsBasename);

  return undefined;
}

function stripLeadingPathPrefix(path: string, prefix: string): string | undefined {
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, '');
  if (!normalizedPrefix) return undefined;

  const current = path.replace(/^(?:\.\/)+/, '');
  if (current.startsWith('../')) return undefined;
  if (current === normalizedPrefix) return undefined;
  if (!current.startsWith(`${normalizedPrefix}/`)) return undefined;
  return current.slice(normalizedPrefix.length + 1);
}

function normalizeUrlPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
}

function lastPathSegment(path: string): string {
  const normalized = normalizeUrlPath(path);
  return normalized.split('/').filter(Boolean).at(-1) ?? '';
}

function toContentImagesUrl(rel: string): string | undefined {
  const normalized = rel.replaceAll(sep, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((part) => part === '..')) return undefined;
  return `/content/images/${normalized}`;
}

function isElement(node: ChildNode): node is Element {
  return 'attribs' in node && 'children' in node;
}
