import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import {
  DEFAULT_EDITOR_FOCUS_STATE,
  type EditorSaveState,
  reduceEditorFocus,
} from '../../editor-focus.ts';
import { approvePage, renameContentSlug, saveContent } from '../lib/api.ts';
import {
  buildFrontmatter as buildFrontmatterFor,
  snapshotFromItem as snapshotFromItemFor,
} from '../lib/editor-snapshot.ts';
import { computeWarnings } from '../lib/editor-warnings.ts';
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
import { FeatureImageField } from './FeatureImageField.tsx';
import { ProseEditor } from './ProseEditor.tsx';

const AUTHOR_SOCIAL_FIELDS = [
  ['twitter', 'X / Twitter'],
  ['facebook', 'Facebook'],
  ['linkedin', 'LinkedIn'],
  ['bluesky', 'Bluesky'],
  ['mastodon', 'Mastodon'],
  ['threads', 'Threads'],
  ['tiktok', 'TikTok'],
  ['youtube', 'YouTube'],
  ['instagram', 'Instagram'],
  ['github', 'GitHub'],
] as const;

interface EditorViewProps {
  current: DashboardContentItem;
  state: DashboardState | null;
  onCloseEditor: () => void;
  onSaved: () => Promise<void> | void;
  onRenamed?: (kind: DashboardContentItem['kind'], newSlug: string) => Promise<void> | void;
  onConflict: (message: string, current: DashboardContentItem) => void;
  onDirtyChange: (dirty: boolean) => void;
  // Posts / pages only — moves the file to trash. The parent owns the
  // confirm dialog, the API call, and the post-delete navigation.
  onDelete?: () => Promise<void> | void;
}

const SAVE_CHIP_LABEL: Record<EditorSaveState, string> = {
  idle: 'Ready',
  dirty: 'Unsaved',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Error',
};

function snapshotFromItem(item: DashboardContentItem): EditorSnapshot {
  return snapshotFromItemFor(item.kind, item);
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
  }, [focus.focusMode, props.onCloseEditor]);

  function patchSnapshot(part: Partial<EditorSnapshot>) {
    setSnapshot((prev) => ({ ...prev, ...part }));
  }

  /* Insert text around the current selection (or at the caret if no
   * selection). Used by Cmd+B (wrap with **) and Cmd+I (wrap with _).
   * Uses document.execCommand('insertText') so the change participates
   * in the browser's native undo stack. */
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
      // Append an old→new redirect so the published URL keeps
      // resolving after the slug change (#2150).
      redirect: true,
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

  /* Upload an image to /content/images/ and insert a Markdown image
   * reference at the caret. Used by paste + drag-drop on the body
   * and by the body toolbar's Image button. */
  function buildFrontmatter(): Record<string, unknown> {
    return buildFrontmatterFor(current.kind, current.frontmatter, snapshot);
  }

  async function handleSave() {
    // Snapshot the on-disk state for the local revision log — used for
    // the rollback path. Includes every editable field on EditorSnapshot.
    const onDisk = snapshotFromItem(current);
    const revision: RevisionPayload = {
      at: new Date().toISOString(),
      path: current.path,
      kind: current.kind,
      frontmatter: { ...current.frontmatter },
      ...onDisk,
      // onDisk already carries slug from snapshotFromItem.
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
            class="textLink editorPreviewLink"
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
          <div class="bodyWrap proseWrap">
            {isContent ? (
              <ProseEditor
                key={`${current.path}@${current.fingerprint.mtimeMs}`}
                resetKey={`${current.path}@${current.fingerprint.mtimeMs}`}
                initialMarkdown={baseline.body}
                onChange={(markdown) => patchSnapshot({ body: markdown })}
                getComponents={() => props.state?.components?.items ?? []}
              />
            ) : null}
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
        <aside
          class="editorMeta"
          aria-label={
            current.kind === 'authors'
              ? 'Author metadata'
              : current.kind === 'tags'
                ? 'Tag metadata'
                : 'Post metadata'
          }
        >
          <div class="editorMetaSection">
            <div class="editorMetaLabel">Slug (filename)</div>
            <input
              class="editorMetaInput editorMetaSlugInput"
              type="text"
              value={slugDraft}
              onInput={(event) => setSlugDraft((event.currentTarget as HTMLInputElement).value)}
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
          {isContent ? (
            <div class="editorMetaSection">
              <div class="editorMetaLabel">Status</div>
              <select
                class="statusPill editorMetaStatus"
                id="editStatus"
                value={snapshot.status}
                onChange={(event) =>
                  patchSnapshot({ status: (event.currentTarget as HTMLSelectElement).value })
                }
              >
                <option>published</option>
                <option>draft</option>
              </select>
            </div>
          ) : null}
          <div class="editorMetaSection">
            <div class="editorMetaLabel">
              {current.kind === 'authors' ? 'Cover image' : 'Feature image'}
            </div>
            <FeatureImageField
              value={snapshot.featureImage}
              alt={snapshot.featureImageAlt}
              showAlt
              onChange={({ value, alt }) =>
                patchSnapshot({
                  featureImage: value,
                  featureImageAlt: alt ?? snapshot.featureImageAlt,
                  ...(value ? {} : { featureImageCaption: '' }),
                })
              }
              onStatus={setNotice}
            />
          </div>
          {current.kind === 'authors' ? (
            <>
              <div class="editorMetaSection">
                <div class="editorMetaLabel">Bio</div>
                <textarea
                  class="editorMetaInput editorMetaTextarea"
                  rows={4}
                  placeholder="Short author bio shown on author pages"
                  value={snapshot.bio}
                  onInput={(event) =>
                    patchSnapshot({
                      bio: (event.currentTarget as HTMLTextAreaElement).value,
                    })
                  }
                />
              </div>
              <div class="editorMetaSection">
                <div class="editorMetaLabel">Website</div>
                <input
                  class="editorMetaInput"
                  type="url"
                  placeholder="https://example.com"
                  value={snapshot.website}
                  onInput={(event) =>
                    patchSnapshot({
                      website: (event.currentTarget as HTMLInputElement).value,
                    })
                  }
                />
              </div>
              <div class="editorMetaSection">
                <div class="editorMetaLabel">Location</div>
                <input
                  class="editorMetaInput"
                  type="text"
                  placeholder="City, country"
                  value={snapshot.location}
                  onInput={(event) =>
                    patchSnapshot({
                      location: (event.currentTarget as HTMLInputElement).value,
                    })
                  }
                />
              </div>
              {AUTHOR_SOCIAL_FIELDS.map(([key, label]) => (
                <div class="editorMetaSection" key={key}>
                  <div class="editorMetaLabel">{label}</div>
                  <input
                    class="editorMetaInput"
                    type="text"
                    placeholder={key === 'mastodon' ? 'user@host.example' : '@handle or URL'}
                    value={snapshot[key]}
                    onInput={(event) =>
                      patchSnapshot({
                        [key]: (event.currentTarget as HTMLInputElement).value,
                      })
                    }
                  />
                </div>
              ))}
            </>
          ) : null}
          {current.kind === 'tags' ? (
            <>
              <div class="editorMetaSection">
                <div class="editorMetaLabel">Description</div>
                <textarea
                  class="editorMetaInput editorMetaTextarea"
                  rows={3}
                  placeholder="Short tag description shown on tag pages"
                  value={snapshot.description}
                  onInput={(event) =>
                    patchSnapshot({
                      description: (event.currentTarget as HTMLTextAreaElement).value,
                    })
                  }
                />
              </div>
              <div class="editorMetaSection">
                <div class="editorMetaLabel">Accent color</div>
                <input
                  class="editorMetaInput editorMetaColor"
                  type="color"
                  value={snapshot.accentColor || '#888888'}
                  onInput={(event) =>
                    patchSnapshot({
                      accentColor: (event.currentTarget as HTMLInputElement).value,
                    })
                  }
                />
              </div>
            </>
          ) : null}
          {isContent ? (
            <>
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
                {(() => {
                  const existing = state?.tags?.items?.map((t: { slug: string }) => t.slug) ?? [];
                  return (
                    <>
                      <input
                        class="editorMetaInput"
                        type="text"
                        list="editorTagOptions"
                        placeholder="comma, separated · existing tags suggest"
                        value={snapshot.tags}
                        onInput={(event) =>
                          patchSnapshot({
                            tags: (event.currentTarget as HTMLInputElement).value,
                          })
                        }
                      />
                      <datalist id="editorTagOptions">
                        {existing.map((slug: string) => (
                          <option key={slug} value={slug} />
                        ))}
                      </datalist>
                    </>
                  );
                })()}
              </div>
              <div class="editorMetaSection">
                <div class="editorMetaLabel">Author</div>
                {(() => {
                  const selected = snapshot.authors
                    .split(/[,\n]/)
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const fromState =
                    state?.authors?.items?.map((a: { slug: string }) => a.slug) ?? [];
                  const options = Array.from(new Set([...fromState, ...selected])).sort();
                  if (options.length === 0) {
                    return (
                      <div class="editorMetaEmpty">
                        No authors yet. Add one in <code>content/authors/</code>.
                      </div>
                    );
                  }
                  const currentValue = selected[0] ?? '';
                  return (
                    <select
                      class="editorMetaInput"
                      value={currentValue}
                      onChange={(event) => {
                        const next = (event.currentTarget as HTMLSelectElement).value;
                        patchSnapshot({ authors: next });
                      }}
                    >
                      {currentValue === '' ? <option value="">(none)</option> : null}
                      {options.map((slug) => (
                        <option key={slug} value={slug}>
                          {slug}
                        </option>
                      ))}
                    </select>
                  );
                })()}
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
            </>
          ) : null}
        </aside>
      </div>
      {/* Footer is rendered only when there's a notice to surface or when
       * the Approve action is available — otherwise Save is in the header
       * and the footer is dead weight. */}
      {notice || isContent ? (
        <div class="editorFooter">
          <output class="notice" id="notice">
            {notice}
          </output>
          <div class="editorActions">
            {isContent && props.onDelete ? (
              <button
                class="btn secondary editorDelete"
                id="deleteContent"
                type="button"
                onClick={() => {
                  void props.onDelete?.();
                }}
                title={`Move this ${current.kind === 'pages' ? 'page' : 'post'} to trash`}
              >
                Delete
              </button>
            ) : null}
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
