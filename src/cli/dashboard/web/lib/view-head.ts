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
  components: {
    kicker: 'Workspace',
    title: 'Components',
    meta: 'Reusable HTML + CSS snippets embedded in post and page bodies via the {slug} shortcode.',
  },
  settings: {
    kicker: 'Settings · Site',
    title: 'Site',
    meta: 'Site identity (title, URL, accent color, description) saved to nectar.toml.',
  },
  design: {
    kicker: 'Settings · Design',
    title: 'Design',
    meta: 'Theme selection. Preview uses the active theme immediately after saving; dist updates after the next build.',
  },
  integration: {
    kicker: 'Settings · Integration',
    title: 'Integration',
    meta: 'Site-wide code injection for analytics, custom <meta>, and third-party widgets.',
  },
  authors: {
    kicker: 'Workspace',
    title: 'Authors',
    meta: 'Author files in content/authors. Generated entries appear until you materialize a file.',
  },
  tags: {
    kicker: 'Workspace',
    title: 'Tags',
    meta: 'Tag files in content/tags. Inferred tags from posts appear until you materialize a file.',
  },
  migration: {
    kicker: 'Settings · Migration',
    title: 'Migration',
    meta: 'Bring posts, pages, authors, and tags in from a Ghost JSON/ZIP export.',
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

/* Kind-aware page title — "New post" / "New page" / "New author" / "New tag"
 * matches the URL the user navigated to. The form below no longer needs
 * the Kind selector because of this. */
export function createHeadFor(
  kind: 'posts' | 'pages' | 'components' | 'authors' | 'tags',
): ViewHeadCopy {
  const single =
    kind === 'posts'
      ? 'post'
      : kind === 'pages'
        ? 'page'
        : kind === 'components'
          ? 'component'
          : kind === 'authors'
            ? 'author'
            : 'tag';
  return {
    kicker: 'Workspace · Create',
    title: `New ${single}`,
    meta: `Create the ${single} first, then continue in the full editor page.`,
  };
}

export type SurfaceState = 'loading' | 'error' | 'conflict' | 'empty';

interface SurfaceCopy {
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
