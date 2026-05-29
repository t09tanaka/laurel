import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { type ImportComponentsResult, importComponentsBundle } from '../lib/api.ts';
import { useModalCanClose } from './Modal.tsx';
import type { ToastApi } from './Toast.tsx';
import { UploadDropzone } from './UploadDropzone.tsx';

interface ComponentImportModalProps {
  onClose: () => void;
  onImported: () => void;
  toast: ToastApi;
}

/**
 * Modal for importing a bulk components bundle. Drop a `.zip`, preview how many
 * snippets it carries and how many collide with existing components, then
 * commit. Components have no workflow status, so nothing is stamped on import —
 * collisions are overwritten only when the editor confirms.
 */
export function ComponentImportModal({
  onClose,
  onImported,
  toast,
}: ComponentImportModalProps): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [probe, setProbe] = useState<ImportComponentsResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useModalCanClose(!busy);

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
    setProbing(true);
    try {
      // Dry-run with skip so each collision surfaces as skipped:true.
      setProbe(await importComponentsBundle(next, { dryRun: true, onConflict: 'skip' }));
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
  }

  async function commit(): Promise<void> {
    if (!file || !probe) return;
    setBusy(true);
    try {
      const collides = probe.skipped > 0;
      const result = await importComponentsBundle(file, {
        dryRun: false,
        // Overwrite only when collisions exist; otherwise plain skip leaves
        // any unexpected pre-existing snippet untouched.
        onConflict: collides ? 'overwrite' : 'skip',
      });
      onImported();
      toast.push({
        intent: 'success',
        message: `Imported ${result.written} component${result.written === 1 ? '' : 's'}`,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const total = probe?.components.length ?? 0;
  const collisions = probe?.skipped ?? 0;
  const fresh = total - collisions;

  return (
    <dialog class="modalDialog" aria-modal="true" aria-label="Import a components bundle" open>
      <header class="modalHead">
        <h3>Import components</h3>
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
      <p class="meta">
        Drop a Nectar components bundle <code>.zip</code> to bring a set of reusable{' '}
        <code>{'{slug}'}</code> snippets in from another editor.
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
        <div class="importPreview" data-collision={collisions > 0 ? 'true' : 'false'}>
          <div class="importPreviewHead">
            <span class="importPreviewKind">components</span>
            <span class="importPreviewSlug">
              {total} snippet{total === 1 ? '' : 's'}
            </span>
          </div>
          <p class="importPreviewMeta">
            {fresh} new
            {collisions > 0 ? ` · ${collisions} already exist` : ' · nothing collides'}
          </p>
          <ul class="importPreviewList">
            {probe.components.map((c) => (
              <li key={c.slug} data-collision={c.skipped ? 'true' : 'false'}>
                <code>{`{${c.slug}}`}</code>
                {c.skipped ? <span class="importPreviewWarn">exists</span> : null}
              </li>
            ))}
          </ul>
          {collisions > 0 ? (
            <p class="importPreviewWarn">
              Importing will overwrite {collisions} existing component
              {collisions === 1 ? '' : 's'}.
            </p>
          ) : null}
        </div>
      ) : null}

      <div class="modalActions">
        <button type="button" class="btn secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          class="btn"
          disabled={!probe || busy || probing || total === 0}
          onClick={() => void commit()}
        >
          {busy ? 'Importing…' : collisions > 0 ? `Overwrite & import ${total}` : `Import ${total}`}
        </button>
      </div>
    </dialog>
  );
}
