import type { DashboardView } from '../types.ts';

export interface ViewHeadCopy {
  kicker: string;
  title: string;
  meta: string;
}

const VIEW_HEAD: Record<DashboardView, ViewHeadCopy> = {
  posts: {
    kicker: 'Workspace',
    title: 'Posts',
    meta: 'Posts created newest first. Filter or open one to edit the saved Markdown file.',
  },
  pages: {
    kicker: 'Workspace',
    title: 'Pages',
    meta: 'Pages created newest first. Edits write to Markdown only; approve before the next build.',
  },
  settings: {
    kicker: 'Settings',
    title: 'Settings',
    meta: 'Site, theme, and taxonomy configuration backed by nectar.toml.',
  },
  authors: {
    kicker: 'Settings · Taxonomy',
    title: 'Authors',
    meta: 'Author files in content/authors. Generated entries appear until you materialize a file.',
  },
  tags: {
    kicker: 'Settings · Taxonomy',
    title: 'Tags',
    meta: 'Tag files in content/tags. Inferred tags from posts appear until you materialize a file.',
  },
};

export function viewHeadFor(view: DashboardView): ViewHeadCopy {
  return VIEW_HEAD[view] ?? VIEW_HEAD.posts;
}

export const CREATE_HEAD: ViewHeadCopy = {
  kicker: 'Workspace · Create',
  title: 'New file',
  meta: 'Create the file first, then continue in the full editor page.',
};

export type SurfaceState = 'loading' | 'error' | 'conflict' | 'empty';

export interface SurfaceCopy {
  title: string;
  message: string;
  actionLabel?: string;
}

const SURFACE_COPY: Record<SurfaceState, SurfaceCopy> = {
  loading: {
    title: 'Reading files',
    message: 'Loading the latest saved Markdown and config state from disk.',
  },
  error: {
    title: 'Dashboard could not load',
    message: 'Keep your files unchanged and refresh after fixing the reported problem.',
    actionLabel: 'Refresh',
  },
  conflict: {
    title: 'External change detected',
    message: 'The file changed on disk. Reloaded latest content so you can review before saving.',
    actionLabel: 'Review latest',
  },
  empty: {
    title: 'No files match this view',
    message: 'Try a different search, status filter, or section.',
  },
};

export function surfaceCopy(state: SurfaceState, override: Partial<SurfaceCopy> = {}): SurfaceCopy {
  return { ...SURFACE_COPY[state], ...override };
}
