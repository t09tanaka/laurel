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
  // How collisions are resolved on commit. Defaults to `overwrite` (a handoff
  // bundle is usually the newer source of truth); the editor can switch to
  // skip/rename per import to preserve a locally-customised snippet.
  const [onConflict, setOnConflict] = useState<ConflictPolicy>('overwrite');
  // Which snippets in the bundle to actually import (all by default); the
  // editor unticks rows to leave them out, mirroring the export picker.
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
    setOnConflict('overwrite');
    setProbing(true);
    try {
      // Dry-run over the whole bundle with skip so each collision surfaces as
      // skipped:true; the subset to actually import is chosen afterwards.
      const result = await importComponentsBundle(next, { dryRun: true, onConflict: 'skip' });
      if (probeId.current === id) {
        setProbe(result);
        setSelected(new Set(result.components.map((c) => c.slug)));
      }
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
    setOnConflict('overwrite');
    setSelected(new Set());
  }

  function toggle(slug: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function commit(): Promise<void> {
    if (!file || !probe || selected.size === 0) return;
    setBusy(true);
    try {
      const result = await importComponentsBundle(file, {
        dryRun: false,
        onConflict,
        slugs: [...selected],
      });
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
  const collisions = probe?.components.filter((c) => c.skipped && selected.has(c.slug)).length ?? 0;
  const allSelected = total > 0 && selected.size === total;

  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(probe?.components.map((c) => c.slug) ?? []));
  }

  const commitLabel = busy ? 'Importing…' : `Import ${selected.size}`;

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
        <div class="importPreview">
          <div class="importPreviewHead">
            <span class="importPreviewKind">components</span>
            <span class="importPreviewSlug">
              {total} snippet{total === 1 ? '' : 's'}
            </span>
          </div>
          <p class="importPreviewMeta">
            {selected.size} of {total} selected
            {collisions > 0 ? ` · ${collisions} already exist` : ''}
          </p>
          <label class="exportSelectAll">
            <input type="checkbox" checked={allSelected} disabled={busy} onChange={toggleAll} />
            Select all ({total})
          </label>
          <ul class="exportList">
            {probe.components.map((c) => {
              const checked = selected.has(c.slug);
              return (
                <li key={c.slug}>
                  <label class="exportOption" data-selected={checked ? 'true' : 'false'}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      onChange={() => toggle(c.slug)}
                    />
                    <code>{`{${c.slug}}`}</code>
                    {c.skipped ? <span class="importPreviewWarn">exists</span> : null}
                  </label>
                </li>
              );
            })}
          </ul>
          <label class="field importConflictField">
            <span>Conflict policy</span>
            <select
              id="componentImportConflict"
              value={onConflict}
              disabled={busy}
              onChange={(event) =>
                setOnConflict((event.currentTarget as HTMLSelectElement).value as ConflictPolicy)
              }
            >
              <option value="skip">skip</option>
              <option value="rename">rename</option>
              <option value="overwrite">overwrite</option>
            </select>
          </label>
        </div>
      ) : null}

      <div class="modalActions">
        <button type="button" class="btn secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          class="btn"
          disabled={!probe || busy || probing || selected.size === 0}
          onClick={() => void commit()}
        >
          {commitLabel}
        </button>
      </div>
    </dialog>
  );
}
