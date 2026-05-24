import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { approvePage, saveContent } from '../lib/api.ts';
import { fingerprintToken, normalizeMediaPath } from '../lib/format.ts';
import {
  appendRevision,
  clearDraftsForPath,
  findLatestDraftForPath,
  readRevisions,
  saveDraft,
} from '../lib/storage.ts';
import type {
  ContentSummary,
  DashboardContentItem,
  DashboardState,
  EditorSnapshot,
  RevisionPayload,
} from '../types.ts';

interface EditorViewProps {
  current: DashboardContentItem;
  state: DashboardState | null;
  onCloseEditor: () => void;
  onSaved: () => Promise<void> | void;
  onConflict: (message: string, current: DashboardContentItem) => void;
  onDirtyChange: (dirty: boolean) => void;
}

function snapshotFromItem(item: DashboardContentItem): EditorSnapshot {
  const fm = item.frontmatter;
  return {
    title: String(fm.title ?? fm.name ?? ''),
    status: String(fm.status ?? 'published'),
    featureImage: String(fm.feature_image ?? ''),
    featureImageAlt: String(fm.feature_image_alt ?? ''),
    featureImageCaption: String(fm.feature_image_caption ?? ''),
    body: item.body,
  };
}

function snapshotsEqual(a: EditorSnapshot, b: EditorSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function EditorView(props: EditorViewProps): JSX.Element {
  const { current, state } = props;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-derive baseline when the file identity changes
  const baseline = useMemo(
    () => snapshotFromItem(current),
    [current.path, current.fingerprint.mtimeMs],
  );
  const [snapshot, setSnapshot] = useState<EditorSnapshot>(baseline);
  const [notice, setNotice] = useState('');
  const [pendingDraft, setPendingDraft] = useState(() => findLatestDraftForPath(current.path));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isContent = current.kind === 'posts' || current.kind === 'pages';

  useEffect(() => {
    document.body.classList.add('editorOpen');
    return () => {
      document.body.classList.remove('editorOpen');
    };
  }, []);

  const dirty = !snapshotsEqual(snapshot, baseline);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-signal when dirty boolean flips
  useEffect(() => {
    props.onDirtyChange(dirty);
  }, [dirty]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: snapshot/dirty drive persistence; the rest of current.* is stable per editor session
  useEffect(() => {
    if (!dirty) {
      setPendingDraft(findLatestDraftForPath(current.path));
      return;
    }
    saveDraft({
      kind: current.kind,
      slug: current.slug,
      path: current.path,
      fingerprint: current.fingerprint,
      at: new Date().toISOString(),
      snapshot,
    });
    setPendingDraft(findLatestDraftForPath(current.path));
  }, [snapshot, dirty]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') props.onCloseEditor();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props.onCloseEditor]);

  function patchSnapshot(part: Partial<EditorSnapshot>) {
    setSnapshot((prev) => ({ ...prev, ...part }));
  }

  function buildFrontmatter(): Record<string, unknown> {
    const fm: Record<string, unknown> = { ...current.frontmatter };
    if (current.kind === 'posts' || current.kind === 'pages') {
      fm.title = snapshot.title;
      fm.status = snapshot.status;
      fm.updated_at = new Date().toISOString();
      setOptional(fm, 'feature_image', normalizeMediaPath(snapshot.featureImage));
      setOptional(fm, 'feature_image_alt', snapshot.featureImageAlt.trim());
      setOptional(fm, 'feature_image_caption', snapshot.featureImageCaption.trim());
    } else {
      fm.name = snapshot.title;
    }
    return fm;
  }

  async function handleSave() {
    const revision: RevisionPayload = {
      at: new Date().toISOString(),
      path: current.path,
      kind: current.kind,
      slug: current.slug,
      title: String(current.frontmatter.title ?? current.frontmatter.name ?? ''),
      status: String(current.frontmatter.status ?? 'published'),
      featureImage: String(current.frontmatter.feature_image ?? ''),
      featureImageAlt: String(current.frontmatter.feature_image_alt ?? ''),
      featureImageCaption: String(current.frontmatter.feature_image_caption ?? ''),
      body: current.body,
      frontmatter: { ...current.frontmatter },
    };
    appendRevision(current, revision);
    const fm = buildFrontmatter();
    const { status, data } = await saveContent({
      kind: current.kind,
      slug: current.slug,
      fingerprint: current.fingerprint,
      frontmatter: fm,
      body: snapshot.body,
    });
    if (status === 409 && !data.ok && data.reason === 'conflict' && 'current' in data) {
      const message =
        'This file changed on disk. Your browser draft was kept; review before restoring or saving.';
      setNotice(message);
      props.onConflict(message, data.current);
      return;
    }
    if (status >= 400 || !data.ok) {
      const errorMessage =
        (data as { error?: string }).error ?? 'Could not save file. Browser draft was kept.';
      setNotice(errorMessage);
      return;
    }
    clearDraftsForPath(current.path);
    await props.onSaved();
  }

  async function handleApprove() {
    if (current.kind !== 'pages' || dirty) return;
    const { status, data } = await approvePage({
      slug: current.slug,
      fingerprint: current.fingerprint,
    });
    const typed = data as {
      ok?: boolean;
      current?: DashboardContentItem;
      error?: string;
      reason?: string;
    };
    if (status === 409) {
      const conflictCurrent = typed.current;
      if (conflictCurrent) {
        props.onConflict(
          'This page changed on disk. Reloaded latest content; review before approving.',
          conflictCurrent,
        );
      }
      return;
    }
    if (status >= 400) {
      setNotice(typed.error ?? 'Could not approve page');
      return;
    }
    setNotice('Approved saved page. Future builds use this version until a new edit is approved.');
    await props.onSaved();
  }

  function previewUrl(): string {
    const list = current.kind === 'posts' ? state?.posts.items : state?.pages.items;
    const item = list?.find((entry) => entry.slug === current.slug);
    return (
      (item as ContentSummary | undefined)?.preview?.openUrl ??
      `/preview/content?route=${encodeURIComponent(item ? item.url : `/${current.slug}/`)}`
    );
  }

  function handlePreview() {
    if (dirty) setNotice('Preview renders the saved file. Save first to include current edits.');
    window.open(previewUrl(), '_blank', 'noopener');
  }

  function applySnippet(name: string) {
    const area = textareaRef.current;
    if (!area) return;
    const map: Record<string, [string, string, string]> = {
      bold: ['**', '**', 'bold text'],
      link: ['[', '](https://example.com)', 'link text'],
      code: ['`', '`', 'code'],
      heading: ['\n## ', '\n', 'Heading'],
      list: ['\n- ', '\n', 'List item'],
      image: ['![Alt text](', ')', '/content/images/image.jpg'],
      callout: ['\n> [!NOTE]\n> ', '\n', 'Callout text'],
    };
    const entry = map[name];
    if (!entry) return;
    insertText(area, entry[0], entry[1], entry[2]);
  }

  function insertText(
    area: HTMLTextAreaElement,
    before: string,
    after: string,
    placeholder: string,
  ) {
    const start = area.selectionStart || 0;
    const end = area.selectionEnd || 0;
    const selected = area.value.slice(start, end) || placeholder;
    const next = `${area.value.slice(0, start)}${before}${selected}${after}${area.value.slice(end)}`;
    const cursor = start + before.length + selected.length;
    patchSnapshot({ body: next });
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(cursor, cursor);
    });
  }

  function insertMedia() {
    const path = normalizeMediaPath(
      prompt('Image path under content/images, or an absolute URL') ?? '',
    );
    if (!path) return;
    const alt = prompt('Alt text') ?? '';
    const caption = prompt('Caption (optional)') ?? '';
    const area = textareaRef.current;
    if (!area) return;
    insertText(
      area,
      '',
      `${caption ? `\n\n*${caption}*` : ''}\n`,
      `![${alt.replace(/]/g, '')}](${path.replace(/\)/g, '')})`,
    );
  }

  function restoreDraft() {
    const draft = pendingDraft ?? findLatestDraftForPath(current.path);
    if (!draft) return;
    if (
      !confirm(
        'Restore the browser draft into the editor? It will not write the file until you save.',
      )
    )
      return;
    setSnapshot(draft.snapshot);
    setNotice('Browser draft restored. Save writes it only after fingerprint checks pass.');
  }

  function rollback() {
    const revisions = readRevisions(current);
    const revision = revisions[revisions.length - 1];
    if (!revision) return;
    if (
      !confirm(
        'Restore the latest local revision into the editor? It will not write the file until you save.',
      )
    )
      return;
    setSnapshot({
      title: String(revision.frontmatter.title ?? revision.frontmatter.name ?? ''),
      status: String(revision.frontmatter.status ?? 'published'),
      featureImage: String(revision.frontmatter.feature_image ?? ''),
      featureImageAlt: String(revision.frontmatter.feature_image_alt ?? ''),
      featureImageCaption: String(revision.frontmatter.feature_image_caption ?? ''),
      body: revision.body ?? '',
    });
    setNotice('Local revision restored into the editor. Save after review.');
  }

  const draftMatchesFingerprint =
    pendingDraft &&
    fingerprintToken(pendingDraft.fingerprint) === fingerprintToken(current.fingerprint);
  const revisions = readRevisions(current);
  const warnings = computeWarnings(snapshot.body);
  const previewMeta = currentPreviewMeta(state, current);

  return (
    <section class="editor editorPage open" id="editor" aria-labelledby="editorTitle">
      <div class="editorTop">
        <div>
          <h2 id="editorTitle">{current.path}</h2>
          <div class="meta" id="editorMeta">
            {current.path} · fingerprint {fingerprintToken(current.fingerprint)}
          </div>
        </div>
        <div class="editorActions">
          <button
            class="btn secondary"
            id="previewEditor"
            type="button"
            disabled={!isContent}
            onClick={handlePreview}
          >
            Preview
          </button>
          <button
            class="btn secondary"
            id="closeEditor"
            type="button"
            onClick={props.onCloseEditor}
          >
            Close
          </button>
        </div>
      </div>
      <div class="editorScroll">
        <div class="fields">
          <label class="field">
            <span>Title</span>
            <input
              id="editTitle"
              value={snapshot.title}
              onInput={(event) =>
                patchSnapshot({ title: (event.currentTarget as HTMLInputElement).value })
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  textareaRef.current?.focus();
                }
              }}
            />
          </label>
          <label class="field">
            <span>Status</span>
            <select
              id="editStatus"
              value={snapshot.status}
              disabled={!isContent}
              onChange={(event) =>
                patchSnapshot({ status: (event.currentTarget as HTMLSelectElement).value })
              }
            >
              <option>published</option>
              <option>draft</option>
              <option>scheduled</option>
            </select>
          </label>
        </div>
        <textarea
          id="editBody"
          aria-label="Markdown body"
          ref={textareaRef}
          value={snapshot.body}
          onInput={(event) =>
            patchSnapshot({ body: (event.currentTarget as HTMLTextAreaElement).value })
          }
        />
        <output class={`warningList ${warnings.length ? 'active' : ''}`} id="editorWarnings">
          {warnings.join(' ')}
        </output>
        <details class="advancedPanel" id="mediaPanel">
          <summary>Media</summary>
          <div class="mediaGrid" aria-label="Media fields">
            <label class="field">
              <span>Feature image path</span>
              <input
                id="editFeatureImage"
                placeholder="/content/images/cover.jpg"
                disabled={!isContent}
                value={snapshot.featureImage}
                onInput={(event) =>
                  patchSnapshot({ featureImage: (event.currentTarget as HTMLInputElement).value })
                }
              />
            </label>
            <label class="field">
              <span>Feature image alt</span>
              <input
                id="editFeatureImageAlt"
                disabled={!isContent}
                value={snapshot.featureImageAlt}
                onInput={(event) =>
                  patchSnapshot({
                    featureImageAlt: (event.currentTarget as HTMLInputElement).value,
                  })
                }
              />
            </label>
            <label class="field wide">
              <span>Feature image caption</span>
              <input
                id="editFeatureImageCaption"
                disabled={!isContent}
                value={snapshot.featureImageCaption}
                onInput={(event) =>
                  patchSnapshot({
                    featureImageCaption: (event.currentTarget as HTMLInputElement).value,
                  })
                }
              />
            </label>
          </div>
        </details>
        <details class="advancedPanel" id="formatPanel">
          <summary>Markdown tools</summary>
          <div class="snippetBar" aria-label="Markdown snippets">
            {(
              [
                ['bold', 'B', 'Bold'],
                ['link', 'Link', 'Link'],
                ['code', 'Code', 'Inline code'],
                ['heading', 'H2', 'Heading'],
                ['list', 'List', 'List'],
                ['image', 'Image', 'Image'],
                ['callout', 'Callout', 'Callout'],
              ] as ReadonlyArray<[string, string, string]>
            ).map(([name, label, title]) => (
              <button
                key={name}
                class="btn secondary"
                type="button"
                data-snippet={name}
                title={title}
                onClick={() => applySnippet(name)}
              >
                {label}
              </button>
            ))}
            <button class="btn secondary" id="insertMedia" type="button" onClick={insertMedia}>
              Insert media
            </button>
          </div>
        </details>
        <details class="advancedPanel" id="previewPanel">
          <summary>Preview status</summary>
          <div class={`previewBox ${previewMeta ? 'active' : ''}`} id="artifactPreview">
            {previewMeta ? (
              <>
                <div class="previewMeta">
                  <span>{previewMeta.label} · saved Markdown through active theme</span>
                  {previewMeta.openUrl ? (
                    <a
                      class="previewLink"
                      href={previewMeta.openUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open
                    </a>
                  ) : null}
                </div>
                {previewMeta.openUrl ? (
                  <iframe
                    class="previewFrame"
                    title="Markdown preview"
                    src={previewMeta.openUrl}
                    sandbox={(previewMeta.sandbox?.attributes ?? []).join(' ')}
                    referrerpolicy="no-referrer"
                  />
                ) : (
                  <div class="empty">{previewMeta.detail}</div>
                )}
              </>
            ) : null}
          </div>
        </details>
        <details class="advancedPanel" id="recoveryPanel">
          <summary>Recovery</summary>
          <div class="editorActions">
            <button
              class="btn secondary"
              id="restoreDraft"
              type="button"
              disabled={!pendingDraft}
              onClick={restoreDraft}
            >
              Restore draft
            </button>
            <button
              class="btn secondary"
              id="rollbackEditor"
              type="button"
              disabled={revisions.length === 0}
              onClick={rollback}
            >
              Rollback
            </button>
          </div>
          <output class={`storageNotice ${pendingDraft ? 'active' : ''}`} id="draftNotice">
            {pendingDraft
              ? `Browser draft available for ${pendingDraft.path}${draftMatchesFingerprint ? '.' : ' from an older fingerprint; compare before saving.'}`
              : ''}
          </output>
          <output class={`editorHistory ${revisions.length ? 'active' : ''}`} id="editorHistory">
            {revisions.length
              ? `${revisions.length} local revision(s) kept in this browser before saves.`
              : ''}
          </output>
        </details>
      </div>
      <div class="editorFooter">
        <output class="notice" id="notice">
          {notice}
        </output>
        <div class="editorActions">
          <button
            class="btn secondary"
            id="approvePage"
            type="button"
            disabled={current.kind !== 'pages' || dirty}
            onClick={() => {
              void handleApprove();
            }}
          >
            Approve saved page
          </button>
          <button
            class="btn"
            id="saveEditor"
            type="button"
            onClick={() => {
              void handleSave();
            }}
          >
            Save to file
          </button>
        </div>
      </div>
    </section>
  );
}

function setOptional(fm: Record<string, unknown>, key: string, value: string): void {
  if (value) fm[key] = value;
  else delete fm[key];
}

function computeWarnings(body: string): string[] {
  const warnings: string[] = [];
  if (/!\[\s*\]\(/.test(body)) warnings.push('Markdown image has empty alt text.');
  if (/<img\b(?![^>]*\salt=)[^>]*>/i.test(body))
    warnings.push('HTML image is missing an alt attribute.');
  return warnings;
}

function currentPreviewMeta(
  state: DashboardState | null,
  current: DashboardContentItem,
): ContentSummary['preview'] | null {
  if (!state) return null;
  if (current.kind !== 'posts' && current.kind !== 'pages') return null;
  const list = current.kind === 'posts' ? state.posts.items : state.pages.items;
  const item = list.find((entry) => entry.slug === current.slug);
  return item?.preview ?? null;
}
