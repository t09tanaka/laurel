export type TextColorClass = 'has-light-text' | 'has-dark-text';
export type ContrastTextColor = 'light' | 'dark';
export type RgbColor = [number, number, number];

const NAMED_COLORS: Record<string, RgbColor> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  transparent: [255, 255, 255],
};

export function textColorClassFor(color: string | undefined | null): TextColorClass {
  const rgb = parseColorToRgb(color);
  if (!rgb) return 'has-dark-text';
  const [r, g, b] = rgb;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? 'has-dark-text' : 'has-light-text';
}

export function contrastTextColorFor(color: string | undefined | null): ContrastTextColor {
  return textColorClassFor(color) === 'has-dark-text' ? 'dark' : 'light';
}

export function colorToRgba(
  color: string | undefined | null,
  alpha: string | number | undefined | null = 1,
): string {
  const rgb = parseColorToRgb(color);
  if (!rgb) return '';
  const [r, g, b] = rgb;
  return `rgba(${r}, ${g}, ${b}, ${formatAlpha(alpha)})`;
}

export function parseColorToRgb(input: string | undefined | null): RgbColor | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  if (!value) return null;

  if (value.startsWith('#')) return parseHex(value.slice(1));

  const named = NAMED_COLORS[value];
  if (named) return named;

  const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) return parseRgbArgs(rgbMatch[1] ?? '');

  return null;
}

function formatAlpha(input: string | number | undefined | null): string {
  if (typeof input === 'string' && input.trim().endsWith('%')) {
    const pct = Number.parseFloat(input);
    if (Number.isFinite(pct)) return formatFiniteAlpha(pct / 100);
  }
  const alpha = typeof input === 'number' ? input : Number.parseFloat(String(input ?? 1));
  return formatFiniteAlpha(alpha);
}

function formatFiniteAlpha(input: number): string {
  if (!Number.isFinite(input)) return '1';
  const clamped = Math.max(0, Math.min(1, input));
  return Number.isInteger(clamped) ? String(clamped) : String(Number(clamped.toFixed(3)));
}

function parseHex(hex: string): RgbColor | null {
  let normalized = hex;
  if (normalized.length === 3 || normalized.length === 4) {
    normalized = normalized
      .slice(0, 3)
      .split('')
      .map((ch) => ch + ch)
      .join('');
  } else if (normalized.length === 8) {
    normalized = normalized.slice(0, 6);
  } else if (normalized.length !== 6) {
    return null;
  }
  if (!/^[0-9a-f]{6}$/.test(normalized)) return null;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
}

function parseRgbArgs(args: string): RgbColor | null {
  const parts = args
    .split(/[,\s/]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 3) return null;
  const channels: number[] = [];
  for (let i = 0; i < 3; i++) {
    const raw = parts[i];
    if (!raw) return null;
    const channel = parseChannel(raw);
    if (channel === null) return null;
    channels.push(channel);
  }
  return [channels[0], channels[1], channels[2]] as RgbColor;
}

function parseChannel(token: string): number | null {
  if (token.endsWith('%')) {
    const pct = Number.parseFloat(token.slice(0, -1));
    if (!Number.isFinite(pct)) return null;
    return Math.max(0, Math.min(255, Math.round((pct / 100) * 255)));
  }
  const num = Number.parseFloat(token);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(255, Math.round(num)));
}
