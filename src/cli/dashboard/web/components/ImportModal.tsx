import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { type ImportBundleResult, importBundle } from '../lib/api.ts';
import { BundleDiffView } from './BundleDiffView.tsx';
import { useModalCanClose } from './Modal.tsx';
import type { ToastApi } from './Toast.tsx';
import { UploadDropzone } from './UploadDropzone.tsx';

interface ImportModalProps {
  onClose: () => void;
  onImported: () => void;
  toast: ToastApi;
}

/**
 * Modal for importing a zip entry-bundle. Drop a `.zip`, preview what's inside
 * (title, slug, kind, collision), then commit. Imported entries always land as
 * needs-review (forced server-side), so the reviewer can find and approve them.
 *
 * When the slug collides, "View diff" opens a line-level review where the user
 * accepts or keeps each change instead of blindly overwriting.
 */
export function ImportModal({ onClose, onImported, toast }: ImportModalProps): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [probe, setProbe] = useState<ImportBundleResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'preview' | 'diff'>('preview');

  // Block backdrop dismissal while an import is in flight.
  useModalCanClose(!busy);

  // Esc closes unless an import is running.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function pick(next: File): Promise<void> {
    setFile(next);
    setProbe(null);
    setError('');
    setView('preview');
    setProbing(true);
    try {
      // Dry-run with skip so a slug collision surfaces as skipped:true and the
      // server returns the diff (conflict) for both sides.
      setProbe(await importBundle(next, { dryRun: true, onConflict: 'skip' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProbing(false);
    }
  }

  function clear(): void {
    setFile(null);
    setProbe(null);
    setError('');
    setView('preview');
  }

  function reportSuccess(result: ImportBundleResult): void {
    onImported();
    const tagNote = result.importedTags.length
      ? ` · added ${result.importedTags.length} tag(s)`
      : '';
    const authorNote = result.importedAuthors.length
      ? ` · added ${result.importedAuthors.length} author(s)`
      : '';
    toast.push({
      intent: 'success',
      message: `Imported ${result.slug} · marked for review${tagNote}${authorNote}`,
    });
    if (result.warnings.length) {
      toast.push({ intent: 'info', message: result.warnings.join(' · ') });
    }
    onClose();
  }

  async function commit(): Promise<void> {
    if (!file || !probe) return;
    setBusy(true);
    try {
      const result = await importBundle(file, {
        dryRun: false,
        onConflict: probe.skipped ? 'overwrite' : 'skip',
      });
      reportSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function commitMerge(merged: string): Promise<void> {
    if (!file || !probe?.conflict) return;
    setBusy(true);
    try {
      const result = await importBundle(file, {
        dryRun: false,
        onConflict: 'overwrite',
        mergedContent: merged,
        expectedExisting: probe.conflict.existing,
      });
      reportSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setView('preview');
    } finally {
      setBusy(false);
    }
  }

  const collides = probe?.skipped === true;
  const conflict = probe?.conflict;
  const inDiff = view === 'diff' && !!conflict;

  return (
    <dialog
      class={`modalDialog${inDiff ? ' modalDialog--diff' : ''}`}
      aria-modal="true"
      aria-label="Import a zip bundle"
      open
    >
      <header class="modalHead">
        <h3>{inDiff ? 'Review changes' : 'Import'}</h3>
        <button
          type="button"
          class="modalClose"
          aria-label="Close"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </header>

      {inDiff && conflict ? (
        <>
          <p class="meta">
            Choose which changes to pull into <code>{probe?.slug}</code>. Unselected hunks keep the
            existing content.
          </p>
          <BundleDiffView
            existing={conflict.existing}
            incoming={conflict.incoming}
            busy={busy}
            onBack={() => setView('preview')}
            onApply={(merged) => void commitMerge(merged)}
          />
        </>
      ) : (
        <>
          <p class="meta">
            Drop a Laurel entry bundle <code>.zip</code>. The imported entry lands as{' '}
            <strong>needs&#8209;review</strong>.
          </p>

          <UploadDropzone
            accept=".zip,application/zip"
            file={file}
            disabled={busy}
            hint="Click or drop a .zip bundle"
            onPick={(f) => void pick(f)}
            onClear={clear}
            match={(name) => /\.zip$/i.test(name)}
          />

          {probing ? <p class="meta">Reading bundle…</p> : null}
          {error ? <p class="importError">{error}</p> : null}

          {probe ? (
            <div class="importPreview" data-collision={collides ? 'true' : 'false'}>
              <div class="importPreviewHead">
                <span class="importPreviewKind">{probe.kind}</span>
                <span class="importPreviewSlug">{probe.slug}</span>
              </div>
              <p class="importPreviewTitle">{probe.preview.title}</p>
              {probe.preview.excerpt ? (
                <p class="importPreviewExcerpt">{probe.preview.excerpt}</p>
              ) : null}
              <p class="importPreviewMeta">
                {probe.preview.assetCount} asset(s)
                {probe.preview.tagCount > 0 ? ` · ${probe.preview.tagCount} tag(s)` : ''}
                {probe.preview.authorCount > 0 ? ` · ${probe.preview.authorCount} author(s)` : ''}
                {collides ? ' · a matching entry already exists' : ' · new entry'}
              </p>
              {!collides && probe.importedTags.length > 0 ? (
                <p class="importPreviewMeta">New tags: {probe.importedTags.join(', ')}</p>
              ) : null}
              {!collides && probe.importedAuthors.length > 0 ? (
                <p class="importPreviewMeta">New authors: {probe.importedAuthors.join(', ')}</p>
              ) : null}
              {collides ? (
                <p class="importPreviewWarn">
                  {conflict
                    ? `Importing overwrites the existing ${probe.kind} — or review changes line by line.`
                    : `Importing will overwrite the existing ${probe.kind}.`}
                </p>
              ) : null}
            </div>
          ) : null}

          <div class="modalActions">
            <button type="button" class="btn secondary" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            {collides && conflict ? (
              <button
                type="button"
                class="btn secondary"
                disabled={busy || probing}
                onClick={() => setView('diff')}
              >
                View diff
              </button>
            ) : null}
            <button
              type="button"
              class="btn"
              disabled={!probe || busy || probing}
              onClick={() => void commit()}
            >
              {busy ? 'Importing…' : collides ? 'Overwrite & import' : 'Import'}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
