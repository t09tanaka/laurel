import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { type ImportComponentsResult, importComponentsBundle } from '../lib/api.ts';
import { useModalCanClose } from './Modal.tsx';
import type { ToastApi } from './Toast.tsx';
import { UploadDropzone } from './UploadDropzone.tsx';

type ConflictPolicy = 'skip' | 'overwrite' | 'rename';

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
  // How collisions are resolved on commit. Defaults to the safe `skip` so a
  // pre-existing (possibly locally-customised) snippet is never overwritten
  // unless the editor explicitly chooses to.
  const [onConflict, setOnConflict] = useState<ConflictPolicy>('skip');
  // Monotonic id so a slow probe for a superseded file can't land its result
  // over a newer pick (drop bundle A, quickly swap to B → A's response is stale).
  const probeId = useRef(0);

  useModalCanClose(!busy);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function pick(next: File): Promise<void> {
    probeId.current += 1;
    const id = probeId.current;
    setFile(next);
    setProbe(null);
    setError('');
    setOnConflict('skip');
    setProbing(true);
    try {
      // Dry-run with skip so each collision surfaces as skipped:true.
      const result = await importComponentsBundle(next, { dryRun: true, onConflict: 'skip' });
      if (probeId.current === id) setProbe(result);
    } catch (err) {
      if (probeId.current === id) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (probeId.current === id) setProbing(false);
    }
  }

  function clear(): void {
    probeId.current += 1;
    setFile(null);
    setProbe(null);
    setError('');
    setOnConflict('skip');
  }

  async function commit(): Promise<void> {
    if (!file || !probe) return;
    setBusy(true);
    try {
      const result = await importComponentsBundle(file, { dryRun: false, onConflict });
      onImported();
      const parts = [`${result.written} imported`];
      if (result.renamed > 0) parts.push(`${result.renamed} renamed`);
      if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
      toast.push({ intent: 'success', message: parts.join(', ') });
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
  const commitLabel = busy
    ? 'Importing…'
    : collisions === 0
      ? `Import ${total}`
      : onConflict === 'overwrite'
        ? `Overwrite & import ${total}`
        : onConflict === 'rename'
          ? `Import ${total} (rename ${collisions})`
          : `Import ${fresh} (skip ${collisions})`;

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
            <fieldset class="importConflict">
              <legend>
                {collisions} component{collisions === 1 ? '' : 's'} already exist. On conflict:
              </legend>
              {(
                [
                  ['skip', 'Skip them (keep existing)'],
                  ['overwrite', 'Overwrite with the bundle'],
                  ['rename', 'Keep both (import as -2, -3…)'],
                ] as [ConflictPolicy, string][]
              ).map(([value, label]) => (
                <label key={value} class="importConflictOption">
                  <input
                    type="radio"
                    name="componentImportConflict"
                    value={value}
                    checked={onConflict === value}
                    disabled={busy}
                    onChange={() => setOnConflict(value)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
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
          {commitLabel}
        </button>
      </div>
    </dialog>
  );
}
