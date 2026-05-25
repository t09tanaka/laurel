import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { saveContent } from '../lib/api.ts';
import type { DashboardContentItem } from '../types.ts';

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
}

export function ComponentEditorView(props: ComponentEditorViewProps): JSX.Element {
  const { current } = props;
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

  const baselineKey = `${current.path}@${current.fingerprint.mtimeMs}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: rehydrate on file switch
  useEffect(() => {
    setDescription(typeof fm.description === 'string' ? fm.description : '');
    setCss(parsed.css);
    setHtml(parsed.html);
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

  return (
    <section class="editor editorPage open" id="editor" aria-labelledby="editorTitle">
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
        <div class="editorFocusBar">
          <span
            class="saveChip"
            data-state={saving ? 'saving' : notice === 'Saved' ? 'saved' : 'idle'}
          >
            {saving ? 'Saving…' : notice || 'Ready'}
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
      <div class="editorCanvas">
        <div class="editorMain editorScroll">
          <div class="titleBlock">
            <div class="titleInput" id="editorTitle" aria-label="Component shortcode">
              {`{${current.slug}}`}
            </div>
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
