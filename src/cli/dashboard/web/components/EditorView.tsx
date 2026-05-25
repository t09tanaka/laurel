import type { JSX } from 'preact';
import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import {
  DEFAULT_EDITOR_FOCUS_STATE,
  type EditorSaveState,
  reduceEditorFocus,
} from '../../editor-focus.ts';
import { approvePage, saveContent, uploadImage } from '../lib/api.ts';
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

const SAVE_CHIP_LABEL: Record<EditorSaveState, string> = {
  idle: 'Ready',
  dirty: 'Unsaved',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Error',
};

const SNIPPETS: ReadonlyArray<[string, string, string]> = [
  ['bold', 'B', 'Bold'],
  ['link', 'Link', 'Link'],
  ['code', 'Code', 'Inline code'],
  ['heading', 'H2', 'Heading'],
  ['list', 'List', 'List'],
  ['image', 'Image', 'Image'],
  ['callout', 'Callout', 'Callout'],
];

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
  const [focus, dispatchFocus] = useReducer(reduceEditorFocus, DEFAULT_EDITOR_FOCUS_STATE);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const savedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isContent = current.kind === 'posts' || current.kind === 'pages';

  useEffect(() => {
    document.body.classList.add('editorOpen');
    return () => {
      document.body.classList.remove('editorOpen');
    };
  }, []);

  useEffect(() => {
    if (focus.focusMode) {
      document.body.classList.add('editorFocus');
      return () => document.body.classList.remove('editorFocus');
    }
    document.body.classList.remove('editorFocus');
    return undefined;
  }, [focus.focusMode]);

  useEffect(() => {
    return () => {
      if (savedFlashTimerRef.current) {
        clearTimeout(savedFlashTimerRef.current);
        savedFlashTimerRef.current = null;
      }
    };
  }, []);

  const dirty = !snapshotsEqual(snapshot, baseline);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-signal when dirty boolean flips
  useEffect(() => {
    props.onDirtyChange(dirty);
    if (dirty) dispatchFocus({ type: 'save/state', value: 'dirty' });
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
      // ⌘S / Ctrl+S — primary writer's shortcut.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
        return;
      }
      if (event.key !== 'Escape') return;
      // Staged dismissal: first Escape exits focus mode, second Escape closes the editor.
      if (focus.focusMode) {
        event.preventDefault();
        dispatchFocus({ type: 'focus/set', value: false });
      } else {
        event.preventDefault();
        props.onCloseEditor();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // handleSave is stable enough across renders; intentionally not listed
    // to avoid re-binding the listener for every snapshot patch.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  }, [focus.focusMode, props.onCloseEditor]);

  function patchSnapshot(part: Partial<EditorSnapshot>) {
    setSnapshot((prev) => ({ ...prev, ...part }));
  }

  /* Insert text around the current selection (or at the caret if no
   * selection). Used by Cmd+B (wrap with **) and Cmd+I (wrap with _). */
  function wrapSelection(before: string, after: string): void {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = ta.value;
    const selected = value.slice(start, end);
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    patchSnapshot({ body: next });
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      const caret = start + before.length + selected.length;
      textareaRef.current.selectionStart = selected ? start + before.length : caret;
      textareaRef.current.selectionEnd = caret;
    });
  }

  /* Upload an image and set it as the post/page feature image. */
  async function uploadFeatureImage(file: File): Promise<void> {
    setNotice(`Uploading feature image ${file.name || ''}…`);
    const result = await uploadImage(file);
    if (!result.ok) {
      setNotice(`Feature image upload failed — ${result.error}`);
      return;
    }
    setNotice('');
    const altFromName = (file.name || 'feature image').replace(/\.[^.]+$/, '');
    patchSnapshot({
      featureImage: result.path,
      featureImageAlt: snapshot.featureImageAlt || altFromName,
    });
  }

  /* Upload an image to /content/images/ and insert a Markdown image
   * reference at the caret. Used by paste + drag-drop on the body
   * and by the body toolbar's Image button. */
  async function insertUploadedImage(file: File): Promise<void> {
    setNotice(`Uploading ${file.name || 'image'}…`);
    const result = await uploadImage(file);
    if (!result.ok) {
      setNotice(`Image upload failed — ${result.error}`);
      return;
    }
    setNotice('');
    const alt = (file.name || 'image').replace(/\.[^.]+$/, '');
    const md = `![${alt}](${result.path})`;
    const ta = textareaRef.current;
    if (!ta) {
      patchSnapshot({ body: `${snapshot.body}\n\n${md}\n` });
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = ta.value;
    const next = value.slice(0, start) + md + value.slice(end);
    patchSnapshot({ body: next });
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      const caret = start + md.length;
      textareaRef.current.selectionStart = caret;
      textareaRef.current.selectionEnd = caret;
    });
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
    dispatchFocus({ type: 'save/state', value: 'saving' });
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
      dispatchFocus({ type: 'save/state', value: 'error' });
      props.onConflict(message, data.current);
      return;
    }
    if (status >= 400 || !data.ok) {
      const errorMessage =
        (data as { error?: string }).error ?? 'Could not save file. Browser draft was kept.';
      setNotice(errorMessage);
      dispatchFocus({ type: 'save/state', value: 'error' });
      return;
    }
    clearDraftsForPath(current.path);
    dispatchFocus({ type: 'save/state', value: 'saved' });
    if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current);
    savedFlashTimerRef.current = setTimeout(() => {
      dispatchFocus({ type: 'save/state', value: 'idle' });
      savedFlashTimerRef.current = null;
    }, 1500);
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
  const saveState = focus.saveState;

  return (
    <section class="editor editorPage open" id="editor" aria-labelledby="editorTitle">
      {/* Role-aware editor chrome — the writing surface is the page.
       * Top bar collapses to a quiet breadcrumb on the left and a
       * minimal action cluster on the right: save state chip + Save +
       * a single overflow for Preview / Close. */}
      <div class="editorTopRow">
        <button
          type="button"
          class="editorBack"
          onClick={props.onCloseEditor}
          aria-label="Close editor and return to list"
        >
          <span class="editorBackArrow" aria-hidden="true">
            ←
          </span>
          <span class="editorBackLabel">
            {current.kind === 'posts'
              ? 'Posts'
              : current.kind === 'pages'
                ? 'Pages'
                : current.kind === 'authors'
                  ? 'Authors'
                  : 'Tags'}
          </span>
        </button>
        <div class="editorMetaRow" id="editorMeta">
          <span id="editorTitle" class="srOnly">
            {current.path}
          </span>
          <span title={`fingerprint ${fingerprintToken(current.fingerprint)}`}>
            {current.path}
          </span>
        </div>
        <div class="editorFocusBar">
          {/* saveChip hidden in idle state — "READY" was visual noise
           * for the default condition. It surfaces only when the writer
           * needs to know something happened (dirty / saving / saved /
           * error). */}
          <span
            class={`saveChip${saveState === 'idle' ? ' saveChipIdle' : ''}`}
            data-state={saveState}
            aria-live="polite"
          >
            {SAVE_CHIP_LABEL[saveState]}
          </span>
          <button
            class="btn secondary editorBtnGhost"
            id="previewEditor"
            type="button"
            disabled={!isContent}
            onClick={handlePreview}
            title="Preview built output"
          >
            Preview
          </button>
          <button
            class="btn"
            id="saveEditorTop"
            type="button"
            onClick={() => {
              void handleSave();
            }}
            title="Save to file (⌘S)"
          >
            Save
          </button>
        </div>
      </div>
      <div class="editorScroll">
        {/* Feature image zone — always visible above the title so
         * uploading the hero image doesn't require digging into More
         * metadata. Click anywhere to pick a file; drag/drop also works. */}
        {isContent ? (
          <label
            class={`featureImageZone${snapshot.featureImage ? ' filled' : ''}`}
            aria-label="Feature image — click or drop to upload"
            onDragOver={(event) => {
              if (event.dataTransfer?.types?.includes('Files')) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
              }
            }}
            onDrop={(event) => {
              const file = Array.from(event.dataTransfer?.files ?? []).find((f) =>
                f.type.startsWith('image/'),
              );
              if (!file) return;
              event.preventDefault();
              void uploadFeatureImage(file);
            }}
          >
            <input
              type="file"
              accept="image/*"
              class="srOnly"
              onChange={(event) => {
                const file = (event.currentTarget as HTMLInputElement).files?.[0];
                if (file) void uploadFeatureImage(file);
              }}
            />
            {snapshot.featureImage ? (
              <>
                <img
                  src={snapshot.featureImage}
                  alt={snapshot.featureImageAlt || 'Feature image'}
                  class="featureImagePreview"
                />
                <span class="featureImageHint">Click or drop to replace</span>
                <button
                  type="button"
                  class="featureImageRemove"
                  onClick={(event) => {
                    event.preventDefault();
                    patchSnapshot({
                      featureImage: '',
                      featureImageAlt: '',
                      featureImageCaption: '',
                    });
                  }}
                  title="Remove feature image"
                >
                  Remove
                </button>
              </>
            ) : (
              <span class="featureImageEmpty">
                <em>Feature image</em> — click or drop a file
              </span>
            )}
          </label>
        ) : null}
        <div class="titleBlock">
          <input
            class="titleInput"
            id="editTitle"
            placeholder="Untitled"
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
          <select
            class="statusPill"
            id="editStatus"
            disabled={!isContent}
            value={snapshot.status}
            onChange={(event) =>
              patchSnapshot({ status: (event.currentTarget as HTMLSelectElement).value })
            }
          >
            <option>published</option>
            <option>draft</option>
            <option>scheduled</option>
          </select>
        </div>
        {/* Body toolbar — visible formatting + image insert. Keeps the
         * paste / drag-drop affordances discoverable. */}
        {isContent ? (
          <div class="bodyToolbar" aria-label="Body formatting">
            <button
              type="button"
              class="bodyToolbarBtn"
              onClick={() => wrapSelection('**', '**')}
              title="Bold (⌘B)"
            >
              <b>B</b>
            </button>
            <button
              type="button"
              class="bodyToolbarBtn"
              onClick={() => wrapSelection('_', '_')}
              title="Italic (⌘I)"
            >
              <i>I</i>
            </button>
            <button
              type="button"
              class="bodyToolbarBtn"
              onClick={() => wrapSelection('[', '](url)')}
              title="Link"
            >
              Link
            </button>
            <label class="bodyToolbarBtn bodyToolbarImage" title="Insert image">
              <input
                type="file"
                accept="image/*"
                class="srOnly"
                onChange={(event) => {
                  const file = (event.currentTarget as HTMLInputElement).files?.[0];
                  if (file) void insertUploadedImage(file);
                  (event.currentTarget as HTMLInputElement).value = '';
                }}
              />
              Image
            </label>
            <span class="bodyToolbarHint">
              <em>or paste / drop an image directly into the body</em>
            </span>
          </div>
        ) : null}
        <div class="bodyWrap">
          <textarea
            id="editBody"
            aria-label="Markdown body"
            ref={textareaRef}
            value={snapshot.body}
            onInput={(event) =>
              patchSnapshot({ body: (event.currentTarget as HTMLTextAreaElement).value })
            }
            onPaste={(event) => {
              const items = event.clipboardData?.items;
              if (!items) return;
              for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (!item || !item.type.startsWith('image/')) continue;
                const file = item.getAsFile();
                if (!file) continue;
                event.preventDefault();
                void insertUploadedImage(file);
                return;
              }
            }}
            onDragOver={(event) => {
              if (event.dataTransfer?.types?.includes('Files')) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
              }
            }}
            onDrop={(event) => {
              const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
                f.type.startsWith('image/'),
              );
              if (!files.length) return;
              event.preventDefault();
              for (const file of files) void insertUploadedImage(file);
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
                const key = event.key.toLowerCase();
                if (key === 'b') {
                  event.preventDefault();
                  wrapSelection('**', '**');
                  return;
                }
                if (key === 'i') {
                  event.preventDefault();
                  wrapSelection('_', '_');
                  return;
                }
                if (key === 'k') {
                  // Reserved for cmdk — let the global handler take it.
                  return;
                }
              }
            }}
          />
          <span class="saveHairline" data-state={saveState} aria-hidden="true" />
        </div>
        <output class={`warningsInline ${warnings.length ? 'active' : ''}`} id="editorWarnings">
          {warnings.join(' ')}
        </output>
        <details
          class="metadataPanel"
          id="metadataPanel"
          open={focus.metadataExpanded}
          onToggle={(event) =>
            dispatchFocus({
              type: 'metadata/set',
              value: (event.currentTarget as HTMLDetailsElement).open,
            })
          }
        >
          <summary>More metadata{pendingDraft ? ' · draft available' : ''}</summary>
          <div class="metadataBody">
            {isContent ? (
              <section class="metadataSection" aria-label="Media">
                <h4>Media</h4>
                <div class="mediaGrid">
                  <label class="field">
                    <span>Feature image path</span>
                    <input
                      id="editFeatureImage"
                      placeholder="/content/images/cover.jpg"
                      disabled={!isContent}
                      value={snapshot.featureImage}
                      onInput={(event) =>
                        patchSnapshot({
                          featureImage: (event.currentTarget as HTMLInputElement).value,
                        })
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
              </section>
            ) : null}
            <section class="metadataSection" aria-label="Markdown tools">
              <h4>Markdown tools</h4>
              <div class="snippetBar" aria-label="Markdown snippets">
                {SNIPPETS.map(([name, label, title]) => (
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
            </section>
            {previewMeta ? (
              <section class="metadataSection" aria-label="Preview">
                <h4>Preview</h4>
                <div class="previewBox active" id="artifactPreview">
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
                </div>
              </section>
            ) : null}
            <section class="metadataSection" aria-label="Recovery">
              <h4>Recovery</h4>
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
              <output
                class={`editorHistory ${revisions.length ? 'active' : ''}`}
                id="editorHistory"
              >
                {revisions.length
                  ? `${revisions.length} local revision(s) kept in this browser before saves.`
                  : ''}
              </output>
            </section>
          </div>
        </details>
      </div>
      {/* Footer is rendered only when there's a notice to surface or when
       * the Approve action is available — otherwise Save is in the header
       * and the footer is dead weight. */}
      {notice || current.kind === 'pages' ? (
        <div class="editorFooter">
          <output class="notice" id="notice">
            {notice}
          </output>
          <div class="editorActions">
            {current.kind === 'pages' ? (
              <button
                class="btn secondary"
                id="approvePage"
                type="button"
                disabled={dirty}
                onClick={() => {
                  void handleApprove();
                }}
              >
                Approve saved page
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {/* Hidden trailing Save retained for tests/keyboard shortcuts that may
       * reference #saveEditor. Visually it's the top header Save users see. */}
      <div hidden>
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
