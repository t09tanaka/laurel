import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import {
  DEFAULT_EDITOR_FOCUS_STATE,
  type EditorSaveState,
  reduceEditorFocus,
} from '../../editor-focus.ts';
import { approvePage, renameContentSlug, saveContent, uploadImage } from '../lib/api.ts';
import { fingerprintToken, normalizeMediaPath } from '../lib/format.ts';
import {
  appendRevision,
  clearDraftsForPath,
  findLatestDraftForPath,
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
  onRenamed?: (kind: DashboardContentItem['kind'], newSlug: string) => Promise<void> | void;
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

function snapshotFromItem(item: DashboardContentItem): EditorSnapshot {
  const fm = item.frontmatter;
  const list = (value: unknown): string => {
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean).join(', ');
    if (typeof value === 'string') return value;
    return '';
  };
  return {
    title: String(fm.title ?? fm.name ?? ''),
    status: String(fm.status ?? 'published'),
    featureImage: String(fm.feature_image ?? ''),
    featureImageAlt: String(fm.feature_image_alt ?? ''),
    featureImageCaption: String(fm.feature_image_caption ?? ''),
    excerpt: String(fm.custom_excerpt ?? fm.excerpt ?? ''),
    tags: list(fm.tags),
    authors: list(fm.authors ?? fm.author),
    publishedAt: String(fm.published_at ?? fm.date ?? ''),
    metaTitle: String(fm.meta_title ?? ''),
    metaDescription: String(fm.meta_description ?? ''),
    canonicalUrl: String(fm.canonical_url ?? ''),
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
  const [, setPendingDraft] = useState(() => findLatestDraftForPath(current.path));
  const [slugDraft, setSlugDraft] = useState(current.slug);
  const slugDraftRef = useRef(slugDraft);
  slugDraftRef.current = slugDraft;
  // Ref-of-closure pattern so the document keydown handler always runs
  // the latest save logic (slug-aware) without re-binding on every
  // snapshot change. Set immediately below the function definitions.
  const saveActionRef = useRef<(() => Promise<void>) | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: slugDraft re-sets when the file identity flips
  useEffect(() => {
    setSlugDraft(current.slug);
  }, [current.slug, current.path]);
  const [focus, dispatchFocus] = useReducer(reduceEditorFocus, DEFAULT_EDITOR_FOCUS_STATE);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const savedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isContent = current.kind === 'posts' || current.kind === 'pages';

  // useLayoutEffect so the body class is set before paint — otherwise
  // the editor briefly renders inside the dashboard sidebar before
  // collapsing to full-viewport mode.
  useLayoutEffect(() => {
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
        // Always go through the ref so we run the latest closures —
        // commitSlugRename / handleSave read snapshot, slugDraft, etc.
        void saveActionRef.current?.();
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
    // handleSave / commitSlugRename are stable enough across renders;
    // intentionally not listed to avoid re-binding the listener for
    // every snapshot patch.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  }, [focus.focusMode, props.onCloseEditor]);

  function patchSnapshot(part: Partial<EditorSnapshot>) {
    setSnapshot((prev) => ({ ...prev, ...part }));
  }

  /* Insert text around the current selection (or at the caret if no
   * selection). Used by Cmd+B (wrap with **) and Cmd+I (wrap with _).
   * Uses document.execCommand('insertText') so the change participates
   * in the browser's native undo stack. */
  function wrapSelection(before: string, after: string): void {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = ta.value.slice(start, end);
    const insert = before + selected + after;
    /* execCommand is deprecated but still the only way to insert text
     * into a textarea while preserving the undo stack. */
    if (!document.execCommand('insertText', false, insert)) {
      // Fallback: direct mutation (loses undo).
      ta.setRangeText(insert, start, end, 'end');
    }
    patchSnapshot({ body: ta.value });
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const caret = start + before.length + selected.length;
      textareaRef.current.selectionStart = selected ? start + before.length : caret;
      textareaRef.current.selectionEnd = caret;
    });
  }

  /* Persist a slug rename when the sidebar input loses focus.
   * Validates basic slug shape (lowercase + digits + dashes), then calls
   * the rename endpoint and lets the parent reload the editor against
   * the new path. */
  async function commitSlugRename(): Promise<void> {
    const next = slugDraft.trim().toLowerCase();
    if (!next || next === current.slug) {
      setSlugDraft(current.slug);
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(next)) {
      setNotice('Slug must be lowercase letters, digits, or hyphens.');
      setSlugDraft(current.slug);
      return;
    }
    if (current.kind !== 'posts' && current.kind !== 'pages') {
      setSlugDraft(current.slug);
      return;
    }
    setNotice(`Renaming to ${next}…`);
    const result = await renameContentSlug({
      kind: current.kind,
      oldSlug: current.slug,
      newSlug: next,
      fingerprint: current.fingerprint,
      redirect: false,
    });
    if (!result.ok) {
      setNotice(`Rename failed — ${result.error ?? result.reason}`);
      setSlugDraft(current.slug);
      return;
    }
    setNotice(`Renamed to ${next}.`);
    // Notify parent so it can re-fetch the editor against the new slug
    // and update the URL.
    if (props.onRenamed) {
      await props.onRenamed(current.kind, next);
    } else {
      await props.onSaved();
    }
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
    ta.focus();
    const start = ta.selectionStart;
    if (!document.execCommand('insertText', false, md)) {
      ta.setRangeText(md, start, ta.selectionEnd, 'end');
    }
    patchSnapshot({ body: ta.value });
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
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
      // Editorial metadata
      setOptional(fm, 'custom_excerpt', snapshot.excerpt.trim());
      // Convert excerpt → custom_excerpt; remove old "excerpt" alias to
      // avoid two copies drifting in the frontmatter.
      if (snapshot.excerpt.trim() && 'excerpt' in fm) dropKey(fm, 'excerpt');
      const splitList = (input: string): string[] =>
        input
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean);
      const tagList = splitList(snapshot.tags);
      if (tagList.length) fm.tags = tagList;
      else dropKey(fm, 'tags');
      const authorList = splitList(snapshot.authors);
      if (authorList.length) {
        // Prefer `authors` plural when there's more than one entry;
        // single → `author` for Ghost compatibility.
        if (authorList.length > 1) {
          fm.authors = authorList;
          dropKey(fm, 'author');
        } else {
          fm.author = authorList[0];
          dropKey(fm, 'authors');
        }
      } else {
        dropKey(fm, 'authors');
        dropKey(fm, 'author');
      }
      const publishedAt = snapshot.publishedAt.trim();
      if (publishedAt) {
        fm.published_at = publishedAt;
        dropKey(fm, 'date');
      } else {
        dropKey(fm, 'published_at');
        dropKey(fm, 'date');
      }
      // SEO overrides
      setOptional(fm, 'meta_title', snapshot.metaTitle.trim());
      setOptional(fm, 'meta_description', snapshot.metaDescription.trim());
      setOptional(fm, 'canonical_url', snapshot.canonicalUrl.trim());
    } else {
      fm.name = snapshot.title;
    }
    return fm;
  }

  async function handleSave() {
    // Snapshot the on-disk state for the local revision log — used for
    // the rollback path. Includes every editable field on EditorSnapshot.
    const onDisk = snapshotFromItem(current);
    const revision: RevisionPayload = {
      at: new Date().toISOString(),
      path: current.path,
      kind: current.kind,
      slug: current.slug,
      frontmatter: { ...current.frontmatter },
      ...onDisk,
      body: current.body,
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

  const warnings = computeWarnings(snapshot.body);
  const saveState = focus.saveState;

  // Refresh the save action on every render so the document-level
  // ⌘S handler always calls the latest closures (slugDraft, current,
  // snapshot, props).
  saveActionRef.current = async () => {
    const next = slugDraftRef.current.trim().toLowerCase();
    if (next && next !== current.slug) {
      await commitSlugRename();
      return;
    }
    await handleSave();
  };

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
      <div class="editorCanvas">
        <div class="editorMain editorScroll">
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
            /* Key bound to the file identity so the textarea remounts
             * only when switching to a different file. Within an edit
             * session it stays uncontrolled (defaultValue + onInput)
             * which preserves the browser's native undo / redo stack. */
            key={`${current.path}@${current.fingerprint.mtimeMs}`}
            id="editBody"
            aria-label="Markdown body"
            ref={textareaRef}
            defaultValue={baseline.body}
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
        {/* Metadata details panel removed per user note — the sidebar
         * already exposes status + feature image (+ alt). Markdown tools
         * are duplicated by the body toolbar; recovery actions remain
         * accessible via browser autosave + the conflict path. */}
        </div>
        {isContent ? (
          <aside class="editorMeta" aria-label="Post metadata">
            {isContent ? (
              <div class="editorMetaSection">
                <div class="editorMetaLabel">Slug (filename)</div>
                <input
                  class="editorMetaInput editorMetaSlugInput"
                  type="text"
                  value={slugDraft}
                  onInput={(event) =>
                    setSlugDraft((event.currentTarget as HTMLInputElement).value)
                  }
                  onBlur={() => {
                    void commitSlugRename();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      (event.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                  spellcheck={false}
                />
              </div>
            ) : null}
            <div class="editorMetaSection">
              <div class="editorMetaLabel">Status</div>
              <select
                class="statusPill editorMetaStatus"
                id="editStatus"
                disabled={!isContent}
                value={snapshot.status}
                onChange={(event) =>
                  patchSnapshot({ status: (event.currentTarget as HTMLSelectElement).value })
                }
              >
                <option>published</option>
                <option>draft</option>
              </select>
            </div>
            <div class="editorMetaSection">
              <div class="editorMetaLabel">Feature image</div>
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
                    <em>Click or drop</em>
                  </span>
                )}
              </label>
              {snapshot.featureImage ? (
                <input
                  class="editorMetaInput"
                  type="text"
                  placeholder="Alt text for screen readers"
                  value={snapshot.featureImageAlt}
                  onInput={(event) =>
                    patchSnapshot({
                      featureImageAlt: (event.currentTarget as HTMLInputElement).value,
                    })
                  }
                  onClick={(event) => event.stopPropagation()}
                />
              ) : null}
            </div>
            <div class="editorMetaSection">
              <div class="editorMetaLabel">Description</div>
              <textarea
                class="editorMetaInput editorMetaTextarea"
                rows={3}
                placeholder="One-line summary for feeds and search results"
                value={snapshot.excerpt}
                onInput={(event) =>
                  patchSnapshot({
                    excerpt: (event.currentTarget as HTMLTextAreaElement).value,
                  })
                }
              />
            </div>
            <div class="editorMetaSection">
              <div class="editorMetaLabel">Tags</div>
              <input
                class="editorMetaInput"
                type="text"
                placeholder="comma, separated"
                value={snapshot.tags}
                onInput={(event) =>
                  patchSnapshot({ tags: (event.currentTarget as HTMLInputElement).value })
                }
              />
            </div>
            <div class="editorMetaSection">
              <div class="editorMetaLabel">Author</div>
              <input
                class="editorMetaInput"
                type="text"
                placeholder="author-slug"
                value={snapshot.authors}
                onInput={(event) =>
                  patchSnapshot({ authors: (event.currentTarget as HTMLInputElement).value })
                }
              />
            </div>
            <div class="editorMetaSection">
              <div class="editorMetaLabel">Published</div>
              <input
                class="editorMetaInput"
                type="text"
                placeholder="2026-01-02 or 2026-01-02T03:04:05Z"
                value={snapshot.publishedAt}
                onInput={(event) =>
                  patchSnapshot({
                    publishedAt: (event.currentTarget as HTMLInputElement).value,
                  })
                }
              />
            </div>
            <details class="editorMetaAdvanced">
              <summary>SEO overrides</summary>
              <div class="editorMetaSection">
                <div class="editorMetaLabel">Meta title</div>
                <input
                  class="editorMetaInput"
                  type="text"
                  placeholder="Title shown in search results"
                  value={snapshot.metaTitle}
                  onInput={(event) =>
                    patchSnapshot({
                      metaTitle: (event.currentTarget as HTMLInputElement).value,
                    })
                  }
                />
              </div>
              <div class="editorMetaSection">
                <div class="editorMetaLabel">Meta description</div>
                <textarea
                  class="editorMetaInput editorMetaTextarea"
                  rows={2}
                  placeholder="Override for og:description / search snippet"
                  value={snapshot.metaDescription}
                  onInput={(event) =>
                    patchSnapshot({
                      metaDescription: (event.currentTarget as HTMLTextAreaElement).value,
                    })
                  }
                />
              </div>
              <div class="editorMetaSection">
                <div class="editorMetaLabel">Canonical URL</div>
                <input
                  class="editorMetaInput"
                  type="text"
                  placeholder="https://example.com/canonical"
                  value={snapshot.canonicalUrl}
                  onInput={(event) =>
                    patchSnapshot({
                      canonicalUrl: (event.currentTarget as HTMLInputElement).value,
                    })
                  }
                />
              </div>
            </details>
          </aside>
        ) : null}
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
  else dropKey(fm, key);
}

function dropKey(fm: Record<string, unknown>, key: string): void {
  // Reflect.deleteProperty avoids Biome's noDelete rule and serializes
  // the frontmatter without the key (rather than leaving `key: null`).
  Reflect.deleteProperty(fm, key);
}

function computeWarnings(body: string): string[] {
  const warnings: string[] = [];
  if (/!\[\s*\]\(/.test(body)) warnings.push('Markdown image has empty alt text.');
  if (/<img\b(?![^>]*\salt=)[^>]*>/i.test(body))
    warnings.push('HTML image is missing an alt attribute.');
  return warnings;
}

