import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { componentsBundleExportUrl } from '../lib/api.ts';
import { useModalCanClose } from './Modal.tsx';
import type { ToastApi } from './Toast.tsx';

interface ComponentExportModalProps {
  components: { slug: string; description: string }[];
  onClose: () => void;
  toast: ToastApi;
}

/**
 * Modal for exporting a components bundle. Lists every `{slug}` snippet with a
 * checkbox (all selected by default); untick the ones to leave out, then export
 * the rest as a portable `.zip`. Previewing the exact set before download
 * mirrors the import modal and avoids the "click = whole site" surprise of a
 * bare download link.
 */
export function ComponentExportModal({
  components,
  onClose,
  toast,
}: ComponentExportModalProps): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(components.map((c) => c.slug)),
  );

  useModalCanClose(true);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function toggle(slug: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  const allSelected = components.length > 0 && selected.size === components.length;

  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(components.map((c) => c.slug)));
  }

  const count = selected.size;

  function doExport(): void {
    if (count === 0) return;
    // When every component is ticked, omit the slugs param so the zip stays in
    // sync with the live set; otherwise scope it to the explicit picks.
    const slugs = allSelected
      ? undefined
      : components.filter((c) => selected.has(c.slug)).map((c) => c.slug);
    // Content-Disposition: attachment downloads without navigating away, so the
    // SPA stays put while the browser saves the zip.
    window.location.href = componentsBundleExportUrl(slugs);
    toast.push({
      intent: 'success',
      message: `Exporting ${count} component${count === 1 ? '' : 's'}`,
    });
    onClose();
  }

  return (
    <dialog class="modalDialog" aria-modal="true" aria-label="Export a components bundle" open>
      <header class="modalHead">
        <h3>Export components</h3>
        <button type="button" class="modalClose" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <p class="meta">
        Choose which <code>{'{slug}'}</code> snippets to include in the handoff <code>.zip</code>.
        Everything is selected by default — untick what you want to leave out.
      </p>

      {components.length > 0 ? (
        <>
          <label class="exportSelectAll">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            Select all ({components.length})
          </label>
          <ul class="exportList">
            {components.map((c) => {
              const checked = selected.has(c.slug);
              return (
                <li key={c.slug}>
                  <label class="exportOption" data-selected={checked ? 'true' : 'false'}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(c.slug)} />
                    <code>{`{${c.slug}}`}</code>
                    {c.description ? <span class="meta">{c.description}</span> : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p class="meta">No components to export.</p>
      )}

      <div class="modalActions">
        <button type="button" class="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" class="btn" disabled={count === 0} onClick={doExport}>
          {count === 0 ? 'Export' : `Export ${count}`}
        </button>
      </div>
    </dialog>
  );
}
