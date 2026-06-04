import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LaurelConfig } from '~/config/schema.ts';
import type { ContentGraph } from '~/content/model.ts';
import { ensureDir } from '~/util/fs.ts';
import { logger } from '~/util/logger.ts';
import { truncateExcerpt } from './search.ts';

interface LunrDoc {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  kind: 'post' | 'page' | 'tag' | 'author';
  tags?: string[];
  authors?: string[];
}

interface LunrBundle {
  index: unknown;
  docs: LunrDoc[];
  meta: {
    generated_at: string;
    site_url: string;
    note: string;
  };
}

// Lunr's runtime is callable like `lunr(builder => …)` and exposes
// `lunr.Index.load` for deserialization. Soft-typed so the optional import
// stays self-contained — we never reach for fields beyond these two.
interface LunrBuilder {
  ref(field: string): void;
  field(field: string, opts?: { boost?: number }): void;
  add(doc: LunrDoc): void;
}
interface LunrIndex {
  toJSON(): unknown;
}
type LunrModule = (builderFn: (this: LunrBuilder, builder: LunrBuilder) => void) => LunrIndex;

let cachedLunr: LunrModule | null | undefined;
let warnedMissingLunr = false;
let cachedRuntime: string | null | undefined;
let warnedMissingRuntime = false;

async function loadLunr(): Promise<LunrModule | null> {
  if (cachedLunr !== undefined) return cachedLunr;
  try {
    // lunr ships without bundled types and `@types/lunr` is not a dependency
    // here. Soft-import via an opaque `unknown` cast so the optional dep
    // doesn't force a global type-stub.
    const mod = (await import('lunr' as string)) as unknown as { default: LunrModule };
    cachedLunr = mod.default;
  } catch (err) {
    if (!warnedMissingLunr) {
      logger.warn(
        `Lunr search index skipped: lunr is not installed (${err instanceof Error ? err.message : String(err)}). Install it (\`bun add lunr\`) to enable [components.search].engine = "lunr" / "json+lunr".`,
      );
      warnedMissingLunr = true;
    }
    cachedLunr = null;
  }
  return cachedLunr;
}

async function loadLunrRuntime(): Promise<string | null> {
  if (cachedRuntime !== undefined) return cachedRuntime;
  try {
    // Resolve lunr's package entry to locate `lunr.min.js` sitting next to it.
    // This keeps the runtime copy in lockstep with the build-time API: if a
    // user pins `lunr@2.4`, the widget ships the matching minified bundle.
    const entry = Bun.resolveSync('lunr', process.cwd());
    const minPath = entry.replace(/lunr(\.min)?\.js$/, 'lunr.min.js');
    const file = Bun.file(minPath);
    if (!(await file.exists())) {
      cachedRuntime = null;
      return cachedRuntime;
    }
    cachedRuntime = await file.text();
  } catch (err) {
    if (!warnedMissingRuntime) {
      logger.warn(
        `Lunr runtime bundle missing: could not locate \`lunr.min.js\` (${err instanceof Error ? err.message : String(err)}). The widget will be emitted without a bundled runtime; pages will need to load lunr from another source.`,
      );
      warnedMissingRuntime = true;
    }
    cachedRuntime = null;
  }
  return cachedRuntime;
}

function buildDocs(opts: {
  config: LaurelConfig;
  content: ContentGraph;
}): LunrDoc[] {
  const { config, content } = opts;
  const cfg = config.components.search;
  const docs: LunrDoc[] = [];
  for (const post of content.posts) {
    if (post.visibility !== 'public' || post.status !== 'published') continue;
    docs.push({
      id: `post:${post.id}`,
      url: post.url,
      title: post.title,
      excerpt: truncateExcerpt(post.custom_excerpt ?? post.excerpt, cfg.excerpt_words),
      kind: 'post',
      tags: post.tags.map((t) => t.slug),
      authors: post.authors.map((a) => a.slug),
    });
  }
  if (cfg.include_pages) {
    for (const page of content.pages) {
      if (page.status !== 'published') continue;
      docs.push({
        id: `page:${page.id}`,
        url: page.url,
        title: page.title,
        excerpt: truncateExcerpt(page.custom_excerpt ?? page.excerpt, cfg.excerpt_words),
        kind: 'page',
      });
    }
  }
  if (cfg.include_tags) {
    for (const tag of content.tags) {
      if (tag.visibility !== 'public') continue;
      docs.push({
        id: `tag:${tag.id}`,
        url: tag.url,
        title: tag.name,
        excerpt: '',
        kind: 'tag',
      });
    }
  }
  if (cfg.include_authors) {
    for (const author of content.authors) {
      docs.push({
        id: `author:${author.id}`,
        url: author.url,
        title: author.name,
        excerpt: '',
        kind: 'author',
      });
    }
  }
  return docs;
}

export async function buildLunrIndex(opts: {
  config: LaurelConfig;
  content: ContentGraph;
}): Promise<LunrBundle | null> {
  const { config } = opts;
  const lunr = await loadLunr();
  if (!lunr) return null;
  const docs = buildDocs(opts);
  const index = lunr(function (this: LunrBuilder) {
    this.ref('id');
    this.field('title', { boost: 10 });
    this.field('excerpt');
    this.field('tags', { boost: 2 });
    this.field('authors');
    for (const doc of docs) this.add(doc);
  });
  return {
    index: index.toJSON(),
    docs,
    meta: {
      generated_at: new Date().toISOString(),
      site_url: config.site.url,
      note: 'Pre-built Lunr index emitted by Laurel. Pair with /search/widget.js (or call lunr.Index.load on `.index` directly).',
    },
  };
}

export function searchEngineEmitsLunr(
  engine: LaurelConfig['components']['search']['engine'],
): boolean {
  return engine === 'lunr' || engine === 'json+lunr';
}

export async function emitLunrIndex(opts: {
  config: LaurelConfig;
  content: ContentGraph;
  outputDir: string;
}): Promise<string | null> {
  const { config, outputDir } = opts;
  const cfg = config.components.search;
  if (!cfg.enabled) return null;
  if (!searchEngineEmitsLunr(cfg.engine)) return null;
  const bundle = await buildLunrIndex(opts);
  if (!bundle) return null;
  await ensureDir(outputDir);
  const dest = join(outputDir, 'search-index.json');
  await writeFile(dest, `${JSON.stringify(bundle)}\n`, 'utf8');
  return dest;
}

// Vanilla JS widget. Lazy-loads the index on first input so cold-load is cheap;
// the runtime is expected on `window.lunr` (bundled alongside via
// `search/lunr.min.js`). Wires to:
//   <input data-laurel-search type="search" />
//   <ul data-laurel-search-results></ul>
// The script discovers its sibling JSON via its own src URL, so the same
// build works on root deployments and subpath deployments without
// templating a base path into the widget.
const WIDGET_JS = `(() => {
  let loaded = null;
  function indexUrl(scriptEl) {
    try {
      const here = new URL(scriptEl.src, location.href);
      return new URL("../search-index.json", here).href;
    } catch (_) {
      return "/search-index.json";
    }
  }
  function load(url) {
    if (loaded) return loaded;
    loaded = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("search-index.json fetch failed: " + r.status);
        return r.json();
      })
      .then((data) => {
        if (typeof lunr !== "function") throw new Error("lunr runtime missing on window");
        return { index: lunr.Index.load(data.index), docs: data.docs };
      });
    return loaded;
  }
  function render(results, list) {
    while (list.firstChild) list.removeChild(list.firstChild);
    for (const r of results.slice(0, 10)) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = r.url;
      a.textContent = r.title;
      li.appendChild(a);
      if (r.excerpt) {
        const p = document.createElement("p");
        p.textContent = r.excerpt;
        li.appendChild(p);
      }
      list.appendChild(li);
    }
  }
  function wire(scriptEl) {
    const input = document.querySelector("[data-laurel-search]");
    const list = document.querySelector("[data-laurel-search-results]");
    if (!input || !list) return;
    const url = indexUrl(scriptEl);
    let lastTerm = "";
    input.addEventListener("input", async () => {
      const term = input.value.trim();
      if (term === lastTerm) return;
      lastTerm = term;
      if (term.length < 2) { while (list.firstChild) list.removeChild(list.firstChild); return; }
      let bundle;
      try { bundle = await load(url); } catch (err) { console.error(err); return; }
      const byId = new Map(bundle.docs.map((d) => [d.id, d]));
      let hits;
      try { hits = bundle.index.search(term); } catch (_) { hits = []; }
      render(hits.map((h) => byId.get(h.ref)).filter(Boolean), list);
    });
  }
  const me = document.currentScript;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => wire(me));
  } else {
    wire(me);
  }
})();
`;

export async function emitLunrWidget(opts: {
  config: LaurelConfig;
  outputDir: string;
}): Promise<{ widget: string; runtime: string | null } | null> {
  const { config, outputDir } = opts;
  const cfg = config.components.search;
  if (!cfg.enabled) return null;
  if (!searchEngineEmitsLunr(cfg.engine)) return null;
  const dir = join(outputDir, 'search');
  await ensureDir(dir);
  const widget = join(dir, 'widget.js');
  await writeFile(widget, WIDGET_JS, 'utf8');
  const runtimeSource = await loadLunrRuntime();
  let runtimePath: string | null = null;
  if (runtimeSource) {
    runtimePath = join(dir, 'lunr.min.js');
    await writeFile(runtimePath, runtimeSource, 'utf8');
  }
  return { widget, runtime: runtimePath };
}

export function __resetLunrCacheForTests(): void {
  cachedLunr = undefined;
  warnedMissingLunr = false;
  cachedRuntime = undefined;
  warnedMissingRuntime = false;
}
