import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  type ComponentReferenceRewriteSummary,
  renameContentSlug,
  saveContent,
} from '../lib/api.ts';
import { useEditorOpenBodyClass } from '../lib/use-editor-open-body-class.ts';
import type { DashboardContentItem } from '../types.ts';

const SLUG_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

// Surfaced in the notice strip after a successful rename so the
// operator sees at a glance whether post / page bodies were touched.
// Pluralised inline rather than via a helper to keep the call site
// self-contained.
function renamedNotice(summary: ComponentReferenceRewriteSummary | null): string {
  if (!summary || summary.occurrencesRewritten === 0) return 'Renamed';
  const refs = summary.occurrencesRewritten;
  const files = summary.filesChanged;
  return `Renamed; rewrote ${refs} reference${refs === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}`;
}

// Same fenced-block matcher the CLI loader (src/content/components.ts)
// uses. Re-defining it here rather than importing keeps the dashboard
// bundle from pulling node:fs into the browser build.
const FENCE_PATTERN = /^(`{3,}|~{3,})[ \t]*([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)\r?\n?\1[ \t]*$/gm;

interface ParsedComponent {
  css: string;
  html: string;
}

function extractFences(body: string): ParsedComponent {
  const out: ParsedComponent = { css: '', html: '' };
  for (const match of body.matchAll(FENCE_PATTERN)) {
    const lang = (match[2] ?? '').toLowerCase();
    const content = match[3] ?? '';
    if (lang === 'css' && !out.css) out.css = content;
    else if (lang === 'html' && !out.html) out.html = content;
  }
  return out;
}

function serializeBody(css: string, html: string): string {
  return `\n\`\`\`css\n${css}\n\`\`\`\n\n\`\`\`html\n${html}\n\`\`\`\n`;
}

interface ComponentEditorViewProps {
  current: DashboardContentItem;
  onCloseEditor: () => void;
  onSaved: () => Promise<void> | void;
  onConflict: (message: string, current: DashboardContentItem) => void;
  onDirtyChange: (dirty: boolean) => void;
  onRenamed?: (kind: DashboardContentItem['kind'], newSlug: string) => Promise<void> | void;
}

export function ComponentEditorView(props: ComponentEditorViewProps): JSX.Element {
  const { current } = props;
  // Collapse the dashboard sidebar so this detail view owns the viewport,
  // matching the posts/pages editor.
  useEditorOpenBodyClass();
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-derive when the file identity changes
  const parsed = useMemo(
    () => extractFences(current.body),
    [current.path, current.fingerprint.mtimeMs],
  );
  const fm = current.frontmatter;
  const [description, setDescription] = useState(
    typeof fm.description === 'string' ? fm.description : '',
  );
  const [css, setCss] = useState(parsed.css);
  const [html, setHtml] = useState(parsed.html);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [slugDraft, setSlugDraft] = useState(current.slug);
  const slugDraftRef = useRef(slugDraft);
  slugDraftRef.current = slugDraft;

  // ⌘S / Ctrl+S — mirror the post editor's writer shortcut. We park
  // the latest handleSave in a ref so the listener can stay attached
  // for the lifetime of the editor without re-binding on every render
  // (and without going stale on the closures it depends on).
  const saveActionRef = useRef<() => void>(() => {});

  const baselineKey = `${current.path}@${current.fingerprint.mtimeMs}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: rehydrate on file switch
  useEffect(() => {
    setDescription(typeof fm.description === 'string' ? fm.description : '');
    setCss(parsed.css);
    setHtml(parsed.html);
    setSlugDraft(current.slug);
  }, [baselineKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: report on every diff
  useEffect(() => {
    const dirty =
      description !== (typeof fm.description === 'string' ? fm.description : '') ||
      css !== parsed.css ||
      html !== parsed.html;
    props.onDirtyChange(dirty);
  }, [description, css, html, baselineKey]);

  async function handleSave() {
    setSaving(true);
    setNotice('');
    const next = {
      ...fm,
      slug: current.slug,
      description: description.trim(),
    };
    const body = serializeBody(css, html);
    const result = await saveContent({
      kind: 'components',
      slug: current.slug,
      fingerprint: current.fingerprint,
      frontmatter: next,
      body,
    });
    setSaving(false);
    if (result.data.ok) {
      setNotice('Saved');
      await props.onSaved();
      return;
    }
    if (result.data.reason === 'conflict' && 'current' in result.data) {
      props.onConflict('Component changed on disk', result.data.current);
      return;
    }
    setNotice('error' in result.data ? (result.data.error ?? 'Save failed') : 'Save failed');
  }

  saveActionRef.current = () => {
    if (saving) return;
    void handleSave();
  };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveActionRef.current?.();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Slug rename via /api/content/components/<old>/rename. The endpoint
  // moves the file and, by default, rewrites `{old}` references inside
  // post / page bodies so the build-side expander stays in sync — the
  // notice strip reports how many files were touched. Code regions
  // (fenced blocks, inline code spans) are skipped on the server side
  // to mirror the renderer's contract.
  async function commitRename() {
    const next = slugDraft.trim();
    if (!next || next === current.slug) {
      setSlugDraft(current.slug);
      return;
    }
    if (!SLUG_PATTERN.test(next)) {
      setNotice(`Slug must match ${SLUG_PATTERN.source}`);
      setSlugDraft(current.slug);
      return;
    }
    setSaving(true);
    setNotice(`Renaming to {${next}}…`);
    const result = await renameContentSlug({
      kind: 'components',
      oldSlug: current.slug,
      newSlug: next,
      fingerprint: current.fingerprint,
      redirect: false,
    });
    setSaving(false);
    if (!result.ok) {
      setNotice(`Rename failed — ${result.error ?? result.reason}`);
      setSlugDraft(current.slug);
      return;
    }
    setNotice(renamedNotice(result.rewrittenReferences));
    if (props.onRenamed) await props.onRenamed(current.kind, result.newSlug);
  }

  // Same shape as EditorView's `saveState` reducer: surface a chip the
  // user can act on, hide it when there's nothing to notice. We don't
  // carry a separate "dirty" reducer here yet, so the idle path covers
  // "no save attempt in flight and nothing to flash about" — the
  // ComponentEditor doesn't have a long-running autosave loop, so users
  // signal intent with the Save button and the chip flashes Saved /
  // Error in response.
  const saveState: 'idle' | 'saving' | 'saved' | 'error' = saving
    ? 'saving'
    : notice === 'Saved'
      ? 'saved'
      : notice && notice !== 'Saved'
        ? 'error'
        : 'idle';
  const saveLabel: Record<typeof saveState, string> = {
    idle: 'Ready',
    saving: 'Saving…',
    saved: 'Saved',
    error: notice || 'Error',
  };

  return (
    <section
      class="editor editorPage open componentEditorPage"
      id="editor"
      aria-labelledby="editorTitle"
    >
      {/* Same 3-column top row as EditorView (back / middle metadata
       * slot / focus bar). The middle slot pushes the focus bar to the
       * right edge so the chrome reads the same across editors. */}
      <div class="editorTopRow">
        <button
          type="button"
          class="editorBack"
          onClick={props.onCloseEditor}
          aria-label="Close editor and return to components list"
        >
          <span class="editorBackArrow" aria-hidden="true">
            ←
          </span>
          <span class="editorBackLabel">Components</span>
        </button>
        <div class="editorMetaRow" id="editorMeta">
          <span id="editorTitle" class="srOnly">
            {current.path}
          </span>
        </div>
        <div class="editorFocusBar">
          <span
            class={`saveChip${saveState === 'idle' ? ' saveChipIdle' : ''}`}
            data-state={saveState}
            aria-live="polite"
          >
            {saveLabel[saveState]}
          </span>
          <button
            class="btn"
            type="button"
            onClick={() => {
              void handleSave();
            }}
            disabled={saving}
            title="Save to file (⌘S)"
          >
            Save
          </button>
        </div>
      </div>
      {/* No metadata sidebar to mirror, so we skip .editorCanvas
       * (which forces 320px symmetric padding for the post / page
       * aside) and let .componentEditorPage own the width directly. */}
      <div class="editorScroll componentEditorScroll">
        <div class="componentPage">
          {/* Slug rename is inline: the `{` / `}` flank the input as
           * decorative serif chrome so the editable surface reads as the
           * literal shortcode `{slug}` users embed in post bodies.
           * Commits on blur or Enter via /api/content/components/<old>/rename.
           * Existing `{old}` references in post / page bodies are NOT
           * rewritten — that's a deliberate v1 limitation. */}
          <div class="titleBlock componentTitleBlock">
            <span class="componentTitleBrace" aria-hidden="true">
              {'{'}
            </span>
            <input
              class="titleInput componentTitleInput"
              type="text"
              aria-label="Component slug (rename)"
              spellcheck={false}
              autocomplete="off"
              value={slugDraft}
              // Inline width: 1ch per character (mono font ≈ 1ch wide
              // per glyph) so the input hugs the slug text and the
              // closing `}` brace sits flush against the last letter.
              style={{ width: `${Math.max(slugDraft.length, 4) + 1}ch` }}
              onInput={(e) => setSlugDraft((e.currentTarget as HTMLInputElement).value)}
              onBlur={() => {
                void commitRename();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (e.currentTarget as HTMLInputElement).blur();
                } else if (e.key === 'Escape') {
                  setSlugDraft(current.slug);
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
            />
            <span class="componentTitleBrace" aria-hidden="true">
              {'}'}
            </span>
          </div>
          <div class="componentEditor">
            <label class="componentField">
              <span class="componentFieldLabel">Description</span>
              <input
                class="editorMetaInput"
                type="text"
                value={description}
                placeholder="One-line summary surfaced on the list"
                onInput={(e) => setDescription((e.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label class="componentField">
              <span class="componentFieldLabel">CSS — emitted into &lt;head&gt;</span>
              <textarea
                class="componentTextarea componentTextareaCss"
                value={css}
                spellcheck={false}
                onInput={(e) => setCss((e.currentTarget as HTMLTextAreaElement).value)}
                placeholder=".my-component { display: block; }"
                rows={8}
              />
            </label>
            <label class="componentField">
              <span class="componentFieldLabel">
                HTML — inlined at the {`{${current.slug}}`} tag
              </span>
              <textarea
                class="componentTextarea componentTextareaHtml"
                value={html}
                spellcheck={false}
                onInput={(e) => setHtml((e.currentTarget as HTMLTextAreaElement).value)}
                placeholder='<div class="my-component">…</div>'
                rows={10}
              />
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}
