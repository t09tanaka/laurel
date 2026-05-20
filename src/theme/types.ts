export interface ThemeAsset {
  logicalPath: string;
  fingerprintedPath: string;
  sourcePath: string;
  hash: string;
  size: number;
}

export interface ThemeCustomSettingDefinition {
  type: 'text' | 'select' | 'boolean' | 'color' | 'image';
  options?: string[];
  default?: unknown;
  description?: string;
  group?: string;
  visibility?: string;
}

export interface ThemeImageSize {
  width?: number;
  height?: number;
}

export interface ThemePackage {
  name: string;
  version: string;
  posts_per_page: number;
  image_sizes: Record<string, ThemeImageSize>;
  card_assets: boolean;
  custom: Record<string, ThemeCustomSettingDefinition>;
  customDefaults: Record<string, unknown>;
}

export type ThemeLocaleValue = string | number | boolean;
export type ThemeLocale = Record<string, ThemeLocaleValue>;
export type ThemeLocaleMap = Record<string, ThemeLocale>;

export interface ThemeBundle {
  name: string;
  rootDir: string;
  templates: Record<string, string>;
  partials: Record<string, string>;
  pkg: ThemePackage;
  locales: ThemeLocaleMap;
  assets: Map<string, ThemeAsset>;
}
