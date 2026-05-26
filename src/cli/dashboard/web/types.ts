// Runtime types that flow from the server (commands/dashboard.ts) through
// `/api/state`. UI state types live in src/cli/dashboard/ui-state.ts so they
// can be tested without DOM lib.

export type {
  DashboardContentView,
  DashboardEditorKind,
  DashboardSettingsSubview,
  DashboardShellSection,
  DashboardUiAction,
  DashboardUiState,
  DashboardView,
} from '../ui-state.ts';

export interface DashboardRoute {
  view: import('../ui-state.ts').DashboardView;
  create: { kind: import('../ui-state.ts').DashboardEditorKind } | null;
  editor: { kind: import('../ui-state.ts').DashboardEditorKind; slug: string } | null;
}

export type ContentFingerprint = { path: string; mtimeMs: number; size: number };

export interface ContentSummary {
  slug: string;
  title: string;
  status: string;
  createdAt: string;
  path: string;
  url: string;
  warnings?: Array<{ code: string; severity: string; message: string }>;
  preview?: {
    state: string;
    label: string;
    detail: string;
    sourcePath?: string;
    openUrl?: string;
    sandbox?: { attributes?: string[] };
  };
  approval?: { status?: string; approvedAt?: string } | null;
  [key: string]: unknown;
}

export interface TaxonomySummary {
  slug: string;
  name: string;
  description?: string;
  count: number;
  path?: string;
  url?: string;
  source: 'file' | 'generated';
  editable: boolean;
  orphaned?: boolean;
  materializePath?: string;
  [key: string]: unknown;
}

export interface ComponentSummary {
  slug: string;
  description: string;
  hasCss: boolean;
  hasHtml: boolean;
  path: string;
  fingerprint: ContentFingerprint;
  [key: string]: unknown;
}

export interface DashboardStatusCounts {
  all: number;
  draft: number;
  published: number;
}

export interface DashboardList<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
  query?: Record<string, unknown>;
  statusCounts?: DashboardStatusCounts;
}

export interface SettingsCardValue {
  label: string;
  value: string;
  status?: string;
}

export type SettingsCardCategory =
  | 'general'
  | 'content'
  | 'theme'
  | 'build'
  | 'structure'
  | 'operations'
  | 'advanced';

export type SettingsCardSourceKind = 'config' | 'theme' | 'content' | 'runtime' | 'cli' | 'docs';

export type SettingsCardMode =
  | 'editable'
  | 'read-only'
  | 'cli-action'
  | 'dangerous-cli-only'
  | 'scope-note';

export interface SettingsCard {
  id: string;
  category: SettingsCardCategory;
  section: string;
  title: string;
  summary: string;
  source: string;
  sourceKind: SettingsCardSourceKind;
  mode?: SettingsCardMode;
  status?: string;
  values: SettingsCardValue[];
  command?: string;
}

export interface ThemeOption {
  name: string;
  path?: string;
  active?: boolean;
  description?: string;
  version?: string;
}

export interface DashboardState {
  site: {
    title: string;
    description: string;
    url: string;
    accentColor: string;
    codeinjectionHead: string;
    codeinjectionFoot: string;
    allowCodeInjection: boolean;
  };
  posts: DashboardList<ContentSummary>;
  pages: DashboardList<ContentSummary>;
  authors: DashboardList<TaxonomySummary>;
  tags: DashboardList<TaxonomySummary>;
  components: DashboardList<ComponentSummary>;
  settings: {
    configPath: string;
    fingerprint: ContentFingerprint;
    contentDirs: Record<string, string>;
    outputDir: string;
    theme: { name: string; dir?: string; available?: ThemeOption[] };
    cards: SettingsCard[];
    operations: {
      search: {
        query: string;
        status: string;
        fields: string[];
        bodySearch: string;
        resultCount: number;
      };
      [key: string]: unknown;
    };
  };
  sync: { status: string; [key: string]: unknown };
  build: {
    outputDir: string;
    theme: string;
    previewUrl: string;
    routeCount: number | null;
    warnings: string[];
    freshness: Record<string, number>;
    previewSandbox?: { attributes?: string[] };
  };
  git: { isRepo: boolean; [key: string]: unknown };
  generatedAt: string;
}

export interface DashboardContentItem {
  kind: import('../ui-state.ts').DashboardEditorKind;
  slug: string;
  path: string;
  fingerprint: ContentFingerprint;
  frontmatter: Record<string, unknown>;
  body: string;
  assets?: unknown;
  internalLinks?: unknown;
}

export interface EditorSnapshot {
  // Shared
  title: string;
  body: string;
  // posts/pages
  status: string;
  featureImage: string;
  featureImageAlt: string;
  featureImageCaption: string;
  excerpt: string;
  tags: string;
  authors: string;
  publishedAt: string;
  metaTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  // taxonomy (authors/tags) — empty strings for posts/pages
  slug: string;
  bio: string;
  description: string;
  website: string;
  location: string;
  accentColor: string;
}

export interface DraftPayload {
  kind: import('../ui-state.ts').DashboardEditorKind;
  slug: string;
  path: string;
  fingerprint: ContentFingerprint;
  at: string;
  snapshot: EditorSnapshot;
}

export interface RevisionPayload extends EditorSnapshot {
  at: string;
  path: string;
  kind: import('../ui-state.ts').DashboardEditorKind;
  // slug now inherited from EditorSnapshot.
  frontmatter: Record<string, unknown>;
}
