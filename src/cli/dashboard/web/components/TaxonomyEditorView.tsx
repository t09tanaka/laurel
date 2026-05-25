import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { renameContentSlug, saveContent } from '../lib/api.ts';
import {
  buildFrontmatter as buildFrontmatterFor,
  snapshotFromItem as snapshotFromItemFor,
} from '../lib/editor-snapshot.ts';
import type { DashboardContentItem, EditorSnapshot } from '../types.ts';

interface TaxonomyEditorViewProps {
  current: DashboardContentItem;
  onCloseEditor: () => void;
  onSaved: () => Promise<void> | void;
  onRenamed?: (
    kind: DashboardContentItem['kind'],
    newSlug: string,
  ) => Promise<void> | void;
  onConflict: (message: string, current: DashboardContentItem) => void;
  onDirtyChange: (dirty: boolean) => void;
}

// Author / Tag editing is intentionally separate from the post / page
// editor. The frontmatter surface is small (name, slug, a single short
// text field, and an image) and there is no markdown body to author,
// so the UI here is a compact form rather than a writing surface.
export function TaxonomyEditorView(props: TaxonomyEditorViewProps): JSX.Element {
  const { current } = props;
  const kindLabel = current.kind === 'authors' ? 'author' : 'tag';

  const baseline = useMemo(
    () => snapshotFromItemFor(current.kind, current),
    [current],
  );
  const [snapshot, setSnapshot] = useState<EditorSnapshot>(baseline);
  const [slugDraft, setSlugDraft] = useState(current.slug);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  // Reset when the file identity changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebaseline on file identity change
  useEffect(() => {
    setSnapshot(baseline);
    setSlugDraft(current.slug);
    setNotice('');
    props.onDirtyChange(false);
  }, [current.path, current.fingerprint.mtimeMs]);

  function patch(updates: Partial<EditorSnapshot>) {
    setSnapshot((prev) => {
      const next = { ...prev, ...updates };
      props.onDirtyChange(true);
      return next;
    });
  }

  const dirty = JSON.stringify(snapshot) !== JSON.stringify(baseline);

  async function commitRename() {
    const next = slugDraft.trim();
    if (!next || next === current.slug) {
      setSlugDraft(current.slug);
      return;
    }
    setBusy(true);
    setNotice(`Renaming to ${next}…`);
    const result = await renameContentSlug({
      kind: current.kind,
      oldSlug: current.slug,
      newSlug: next,
      fingerprint: current.fingerprint,
      redirect: true,
    });
    setBusy(false);
    if (!result.ok) {
      setNotice(`Rename failed — ${result.error ?? result.reason}`);
      setSlugDraft(current.slug);
      return;
    }
    setNotice('Renamed');
    if (props.onRenamed) await props.onRenamed(current.kind, result.newSlug);
  }

  async function handleSave() {
    if (busy) return;
    setBusy(true);
    setNotice('Saving…');
    const fm = buildFrontmatterFor(current.kind, current.frontmatter, snapshot);
    const { status, data } = await saveContent({
      kind: current.kind,
      slug: current.slug,
      fingerprint: current.fingerprint,
      frontmatter: fm,
      body: snapshot.body,
    });
    setBusy(false);
    if (status === 409) {
      props.onConflict(
        `${current.path} changed on disk. Reloaded latest content.`,
        (data as { current: DashboardContentItem }).current,
      );
      return;
    }
    if (status >= 400) {
      const error = (data as { error?: string }).error;
      setNotice(`Save failed — ${error ?? 'unknown error'}`);
      return;
    }
    setNotice('Saved');
    props.onDirtyChange(false);
    await props.onSaved();
  }

  return (
    <section class="editor editorPage open" id="editor">
      <div class="editorTopRow">
        <button
          type="button"
          class="editorBack"
          onClick={props.onCloseEditor}
          aria-label={`Close ${kindLabel} editor`}
        >
          <span class="editorBackArrow" aria-hidden="true">
            ←
          </span>
          <span class="editorBackLabel">
            {current.kind === 'authors' ? 'Authors' : 'Tags'}
          </span>
        </button>
        <span class="editorPath" title={current.path}>
          {current.path}
        </span>
        <div class="editorTopActions">
          <button
            class="btn"
            type="button"
            disabled={busy || !dirty}
            onClick={() => {
              void handleSave();
            }}
          >
            Save
          </button>
        </div>
      </div>
      <div class="editorScroll">
        <div class="taxonomyEditorForm">
          <label class="field wide">
            <span>Name</span>
            <input
              class="taxonomyNameInput"
              type="text"
              value={snapshot.title}
              onInput={(event) =>
                patch({ title: (event.currentTarget as HTMLInputElement).value })
              }
              placeholder={current.kind === 'authors' ? 'Author name' : 'Tag name'}
            />
          </label>
          <label class="field wide">
            <span>Slug (filename)</span>
            <input
              class="taxonomySlugInput"
              type="text"
              value={slugDraft}
              spellcheck={false}
              onInput={(event) =>
                setSlugDraft((event.currentTarget as HTMLInputElement).value)
              }
              onBlur={() => {
                void commitRename();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  (event.currentTarget as HTMLInputElement).blur();
                }
              }}
            />
          </label>
          {current.kind === 'authors' ? (
            <>
              <label class="field wide">
                <span>Bio</span>
                <textarea
                  rows={4}
                  value={snapshot.bio}
                  onInput={(event) =>
                    patch({
                      bio: (event.currentTarget as HTMLTextAreaElement).value,
                    })
                  }
                  placeholder="Short bio shown on author pages"
                />
              </label>
              <div class="fields">
                <label class="field">
                  <span>Website</span>
                  <input
                    type="url"
                    value={snapshot.website}
                    onInput={(event) =>
                      patch({
                        website: (event.currentTarget as HTMLInputElement).value,
                      })
                    }
                    placeholder="https://example.com"
                  />
                </label>
                <label class="field">
                  <span>Location</span>
                  <input
                    type="text"
                    value={snapshot.location}
                    onInput={(event) =>
                      patch({
                        location: (event.currentTarget as HTMLInputElement).value,
                      })
                    }
                    placeholder="City, country"
                  />
                </label>
              </div>
              <label class="field wide">
                <span>Cover image (URL)</span>
                <input
                  type="text"
                  value={snapshot.featureImage}
                  onInput={(event) =>
                    patch({
                      featureImage: (event.currentTarget as HTMLInputElement).value,
                    })
                  }
                  placeholder="/content/images/author.jpg"
                />
              </label>
            </>
          ) : (
            <>
              <label class="field wide">
                <span>Description</span>
                <textarea
                  rows={3}
                  value={snapshot.description}
                  onInput={(event) =>
                    patch({
                      description: (event.currentTarget as HTMLTextAreaElement).value,
                    })
                  }
                  placeholder="Short tag description shown on tag pages"
                />
              </label>
              <div class="fields">
                <label class="field">
                  <span>Accent color</span>
                  <input
                    type="color"
                    value={snapshot.accentColor || '#888888'}
                    onInput={(event) =>
                      patch({
                        accentColor: (event.currentTarget as HTMLInputElement).value,
                      })
                    }
                  />
                </label>
                <label class="field">
                  <span>Feature image (URL)</span>
                  <input
                    type="text"
                    value={snapshot.featureImage}
                    onInput={(event) =>
                      patch({
                        featureImage: (event.currentTarget as HTMLInputElement).value,
                      })
                    }
                    placeholder="/content/images/tag.jpg"
                  />
                </label>
              </div>
            </>
          )}
          {notice ? (
            <output class="notice" aria-live="polite">
              {notice}
            </output>
          ) : null}
        </div>
      </div>
    </section>
  );
}
