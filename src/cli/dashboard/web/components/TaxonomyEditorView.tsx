import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { renameContentSlug, saveContent } from '../lib/api.ts';
import {
  buildFrontmatter as buildFrontmatterFor,
  snapshotFromItem as snapshotFromItemFor,
} from '../lib/editor-snapshot.ts';
import type { DashboardContentItem, EditorSnapshot } from '../types.ts';
import { FeatureImageField } from './FeatureImageField.tsx';

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

// Author / Tag editor — laid out like an editorial colophon page:
// large italic display name as the masthead, bottom-rule inputs that
// read as columns of credits rather than form chrome, and a shared
// image dropzone for the cover / feature surface.
export function TaxonomyEditorView(props: TaxonomyEditorViewProps): JSX.Element {
  const { current } = props;
  const isAuthor = current.kind === 'authors';
  const kindLabel = isAuthor ? 'Author' : 'Tag';

  const baseline = useMemo(
    () => snapshotFromItemFor(current.kind, current),
    [current],
  );
  const [snapshot, setSnapshot] = useState<EditorSnapshot>(baseline);
  const [slugDraft, setSlugDraft] = useState(current.slug);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

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
    <section class="editor editorPage open taxonomyEditor" id="editor">
      <div class="editorTopRow">
        <button
          type="button"
          class="editorBack"
          onClick={props.onCloseEditor}
          aria-label={`Close ${kindLabel.toLowerCase()} editor`}
        >
          <span class="editorBackArrow" aria-hidden="true">
            ←
          </span>
          <span class="editorBackLabel">
            {isAuthor ? 'Authors' : 'Tags'}
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
        <div class="taxonomyPage">
          <header class="taxonomyMasthead">
            <span class="taxonomyEyebrow">{kindLabel}</span>
            <input
              class="taxonomyDisplayName"
              type="text"
              value={snapshot.title}
              spellcheck={false}
              onInput={(event) =>
                patch({ title: (event.currentTarget as HTMLInputElement).value })
              }
              placeholder={isAuthor ? 'Author name' : 'Tag name'}
              aria-label={`${kindLabel} name`}
            />
            <div class="taxonomySlugRow">
              <span class="taxonomySlugLead">filename</span>
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
              <span class="taxonomySlugSuffix">.md</span>
            </div>
          </header>

          <div class="taxonomyBody">
            <div class="taxonomyText">
              {isAuthor ? (
                <>
                  <label class="taxonomyRow taxonomyRowLong">
                    <span class="taxonomyLabel">Bio</span>
                    <textarea
                      class="taxonomyTextarea"
                      rows={5}
                      value={snapshot.bio}
                      onInput={(event) =>
                        patch({
                          bio: (event.currentTarget as HTMLTextAreaElement).value,
                        })
                      }
                      placeholder="A line or two — what they cover, where they're from, why they write here."
                    />
                  </label>
                  <div class="taxonomyPair">
                    <label class="taxonomyRow">
                      <span class="taxonomyLabel">Website</span>
                      <input
                        class="taxonomyLine"
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
                    <label class="taxonomyRow">
                      <span class="taxonomyLabel">Location</span>
                      <input
                        class="taxonomyLine"
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
                </>
              ) : (
                <>
                  <label class="taxonomyRow taxonomyRowLong">
                    <span class="taxonomyLabel">Description</span>
                    <textarea
                      class="taxonomyTextarea"
                      rows={4}
                      value={snapshot.description}
                      onInput={(event) =>
                        patch({
                          description: (event.currentTarget as HTMLTextAreaElement).value,
                        })
                      }
                      placeholder="A short summary that introduces this tag on its archive page."
                    />
                  </label>
                  <label class="taxonomyRow taxonomyAccentRow">
                    <span class="taxonomyLabel">Accent</span>
                    <span class="taxonomyAccentControl">
                      <input
                        class="taxonomyAccentColor"
                        type="color"
                        value={snapshot.accentColor || '#888888'}
                        onInput={(event) =>
                          patch({
                            accentColor: (event.currentTarget as HTMLInputElement).value,
                          })
                        }
                        aria-label="Accent color"
                      />
                      <input
                        class="taxonomyAccentHex"
                        type="text"
                        value={snapshot.accentColor}
                        onInput={(event) =>
                          patch({
                            accentColor: (event.currentTarget as HTMLInputElement).value,
                          })
                        }
                        placeholder="#888888"
                        spellcheck={false}
                      />
                    </span>
                  </label>
                </>
              )}
            </div>

            <aside class="taxonomyAside">
              <FeatureImageField
                label={isAuthor ? 'Cover image' : 'Feature image'}
                value={snapshot.featureImage}
                alt={snapshot.featureImageAlt}
                showAlt
                onChange={({ value, alt }) =>
                  patch({
                    featureImage: value,
                    featureImageAlt: alt ?? snapshot.featureImageAlt,
                  })
                }
                onStatus={setNotice}
              />
            </aside>
          </div>

          {notice ? (
            <output class="taxonomyNotice" aria-live="polite">
              {notice}
            </output>
          ) : null}
        </div>
      </div>
    </section>
  );
}
