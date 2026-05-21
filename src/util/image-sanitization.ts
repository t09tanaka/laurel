import { extname } from 'node:path';
import sanitizeHtml, { type IOptions } from 'sanitize-html';

const SVG_SANITIZE_OPTIONS: IOptions = {
  allowedTags: [
    'svg',
    'g',
    'path',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'rect',
    'text',
    'tspan',
    'defs',
    'clipPath',
    'mask',
    'pattern',
    'linearGradient',
    'radialGradient',
    'stop',
    'use',
    'symbol',
    'title',
    'desc',
  ],
  allowedAttributes: {
    '*': [
      'aria-hidden',
      'aria-label',
      'class',
      'clip-path',
      'cx',
      'cy',
      'd',
      'dx',
      'dy',
      'fill',
      'fill-opacity',
      'fill-rule',
      'focusable',
      'font-family',
      'font-size',
      'font-style',
      'font-weight',
      'height',
      'id',
      'mask',
      'offset',
      'opacity',
      'points',
      'preserveAspectRatio',
      'r',
      'role',
      'rx',
      'ry',
      'spreadMethod',
      'stroke',
      'stroke-dasharray',
      'stroke-dashoffset',
      'stroke-linecap',
      'stroke-linejoin',
      'stroke-miterlimit',
      'stroke-opacity',
      'stroke-width',
      'transform',
      'viewBox',
      'width',
      'x',
      'x1',
      'x2',
      'xlink:href',
      'xmlns',
      'xmlns:xlink',
      'y',
      'y1',
      'y2',
    ],
    a: ['href', 'target', 'rel', 'title', 'xlink:href'],
    stop: ['stop-color', 'stop-opacity'],
  },
  allowedSchemes: ['http', 'https'],
  allowedSchemesAppliedToAttributes: ['href', 'xlink:href'],
  allowProtocolRelative: false,
  parser: { lowerCaseAttributeNames: false, lowerCaseTags: false },
  disallowedTagsMode: 'discard',
  parseStyleAttributes: false,
};

export interface ImageAssetSanitizationOptions {
  stripMetadata?: boolean;
}

export function sanitizeImageAssetBytes(
  bytes: Uint8Array,
  label: string,
  contentType = '',
  options: ImageAssetSanitizationOptions = {},
): Buffer {
  const input = Buffer.from(bytes);
  if (isSvg(label, contentType, input)) return sanitizeSvg(input);
  if (options.stripMetadata !== false && isJpeg(label, contentType, input)) {
    return stripJpegExif(input);
  }
  return input;
}

function isSvg(label: string, contentType: string, bytes: Buffer): boolean {
  if (contentType.toLowerCase().split(';')[0]?.trim() === 'image/svg+xml') return true;
  if (extname(label).toLowerCase() === '.svg') return true;
  const prefix = bytes.subarray(0, 256).toString('utf8').trimStart();
  return /^<svg(?:\s|>)/i.test(prefix) || /^<\?xml[\s\S]{0,200}<svg(?:\s|>)/i.test(prefix);
}

function sanitizeSvg(bytes: Buffer): Buffer {
  const sanitized = sanitizeHtml(bytes.toString('utf8'), SVG_SANITIZE_OPTIONS).trim();
  const svg = sanitized.includes('<svg')
    ? sanitized
    : '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  return Buffer.from(`${svg}\n`, 'utf8');
}

function isJpeg(label: string, contentType: string, bytes: Buffer): boolean {
  const mime = contentType.toLowerCase().split(';')[0]?.trim();
  if (mime === 'image/jpeg') return true;
  const ext = extname(label).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return true;
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function stripJpegExif(bytes: Buffer): Buffer {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;

  const chunks: Buffer[] = [bytes.subarray(0, 2)];
  let pos = 2;
  let stripped = false;

  while (pos < bytes.length) {
    const markerStart = pos;
    if (bytes[pos] !== 0xff) {
      chunks.push(bytes.subarray(pos));
      break;
    }
    while (pos < bytes.length && bytes[pos] === 0xff) pos += 1;
    if (pos >= bytes.length) {
      chunks.push(bytes.subarray(markerStart));
      break;
    }

    const marker = bytes[pos];
    if (marker === undefined) {
      chunks.push(bytes.subarray(markerStart));
      break;
    }
    pos += 1;
    if (marker === 0xda || marker === 0xd9) {
      chunks.push(bytes.subarray(markerStart));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(bytes.subarray(markerStart, pos));
      continue;
    }
    if (pos + 2 > bytes.length) {
      chunks.push(bytes.subarray(markerStart));
      break;
    }

    const segmentLength = bytes.readUInt16BE(pos);
    const segmentEnd = pos + segmentLength;
    if (segmentLength < 2 || segmentEnd > bytes.length) {
      chunks.push(bytes.subarray(markerStart));
      break;
    }

    if (marker === 0xe1) {
      stripped = true;
    } else {
      chunks.push(bytes.subarray(markerStart, segmentEnd));
    }
    pos = segmentEnd;
  }

  return stripped ? Buffer.concat(chunks) : bytes;
}
