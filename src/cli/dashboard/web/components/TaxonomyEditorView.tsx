import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { renameContentSlug, saveContent } from '../lib/api.ts';
import {
  buildFrontmatter as buildFrontmatterFor,
  snapshotFromItem as snapshotFromItemFor,
} from '../lib/editor-snapshot.ts';
import type { DashboardContentItem, EditorSnapshot } from '../types.ts';
import { FeatureImageField } from './FeatureImageField.tsx';

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

interface TaxonomyEditorViewProps {
  current: DashboardContentItem;
  onCloseEditor: () => void;
  onSaved: () => Promise<void> | void;
  onRenamed?: (kind: DashboardContentItem['kind'], newSlug: string) => Promise<void> | void;
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

  const baseline = useMemo(() => snapshotFromItemFor(current.kind, current), [current]);
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

  // Cmd/Ctrl+S → save. saveActionRef is reassigned on every render so
  // the listener always invokes the latest closure (busy / snapshot /
  // slugDraft etc. are read fresh).
  const saveActionRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const isCmdS = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's';
      if (!isCmdS) return;
      event.preventDefault();
      void saveActionRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  // Refresh the save closure used by the ⌘S listener every render.
  saveActionRef.current = async () => {
    if (slugDraft.trim() !== current.slug) await commitRename();
    await handleSave();
  };

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
          <span class="editorBackLabel">{isAuthor ? 'Authors' : 'Tags'}</span>
        </button>
        <div class="editorPathPlaceholder" />
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
          <div class="taxonomyBody">
            <div class="taxonomyText">
              <label class="taxonomyRow">
                <span class="taxonomyLabel">{isAuthor ? 'Author name' : 'Tag name'}</span>
                <input
                  class="taxonomyLine"
                  type="text"
                  value={snapshot.title}
                  spellcheck={false}
                  onInput={(event) =>
                    patch({ title: (event.currentTarget as HTMLInputElement).value })
                  }
                  placeholder={isAuthor ? 'Casper' : 'News'}
                />
              </label>
              <label class="taxonomyRow">
                <span class="taxonomyLabel">Slug (filename)</span>
                <input
                  class="taxonomyLine taxonomySlugInput"
                  type="text"
                  value={slugDraft}
                  spellcheck={false}
                  onInput={(event) => setSlugDraft((event.currentTarget as HTMLInputElement).value)}
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
                  <div class="taxonomyPair">
                    {AUTHOR_SOCIAL_FIELDS.map(([key, label]) => (
                      <label class="taxonomyRow" key={key}>
                        <span class="taxonomyLabel">{label}</span>
                        <input
                          class="taxonomyLine"
                          type="text"
                          value={snapshot[key]}
                          onInput={(event) =>
                            patch({
                              [key]: (event.currentTarget as HTMLInputElement).value,
                            })
                          }
                          placeholder={key === 'mastodon' ? 'user@host.example' : '@handle or URL'}
                        />
                      </label>
                    ))}
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
