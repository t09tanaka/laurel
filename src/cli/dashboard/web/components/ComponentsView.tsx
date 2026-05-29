import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { componentsBundleExportUrl } from '../lib/api.ts';
import { matches } from '../lib/format.ts';
import { pathForEditor } from '../lib/routes.ts';
import type { ComponentSummary, DashboardList } from '../types.ts';
import { StatePanel } from './StatePanel.tsx';

// Read-only list of reusable {slug} component snippets. Mirrors the
// posts / pages / taxonomy table conventions so the row affordances are
// familiar: click anywhere on the row to open the editor, hover surfaces
// a right-aligned Detail link, mono slug + faint metadata.
//
// On top of that it adds a lightweight selection model for bulk handoff:
// tick rows (or the header box) to scope an export to a subset, or export
// every component when nothing is selected.
interface ComponentsViewProps {
  list: DashboardList<ComponentSummary>;
  query: string;
  onEdit: (slug: string) => void;
}

export function ComponentsView(props: ComponentsViewProps): JSX.Element {
  const q = props.query.toLowerCase();
  const items = useMemo(
    () =>
      props.list.items.filter((item) =>
        matches(`${item.slug} ${item.description} ${item.path}`, q),
      ),
    [props.list.items, q],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Keep the selection scoped to what is currently visible: a filtered-out
  // slug should not silently ride along in an export.
  const visibleSelected = useMemo(
    () => items.filter((item) => selected.has(item.slug)).map((item) => item.slug),
    [items, selected],
  );
  const selectedCount = visibleSelected.length;
  const allVisibleSelected = items.length > 0 && selectedCount === items.length;

  function toggle(slug: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function toggleAll(): void {
    setSelected((prev) => {
      if (items.length > 0 && items.every((item) => prev.has(item.slug))) {
        const next = new Set(prev);
        for (const item of items) next.delete(item.slug);
        return next;
      }
      const next = new Set(prev);
      for (const item of items) next.add(item.slug);
      return next;
    });
  }

  function exportSelection(): void {
    // No selection means "all"; the endpoint treats an absent slugs param as
    // every component.
    window.location.href = componentsBundleExportUrl(
      selectedCount > 0 ? visibleSelected : undefined,
    );
  }

  const exportLabel =
    selectedCount > 0
      ? `Export ${selectedCount}`
      : `Export all${props.list.total ? ` (${props.list.total})` : ''}`;

  return (
    <div>
      <div class="panelHead listHead">
        <div class="listHeadMeta">
          <h2 class="listHeadTitle srOnly">Components</h2>
          <span class="listHeadCount">
            <span class="listHeadNumeral">{props.list.total}</span>
            <span class="listHeadCountLabel">
              {props.list.total === 1 ? 'component' : 'components'}
            </span>
          </span>
          {selectedCount > 0 ? (
            <span class="listHeadSelection" aria-live="polite">
              {selectedCount} selected
            </span>
          ) : null}
        </div>
        {props.list.total > 0 ? (
          <div class="listHeadActions">
            {selectedCount > 0 ? (
              <button type="button" class="textLink" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            ) : null}
            <button
              type="button"
              class="btn secondary"
              id="exportComponents"
              onClick={exportSelection}
              title="Download a portable .zip bundle of components for handoff"
            >
              {exportLabel}
            </button>
          </div>
        ) : null}
      </div>
      {items.length ? (
        <div class="tableWrap">
          <table class="table">
            <thead class="srOnly">
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all components"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                  />
                </th>
                <th>Slug</th>
                <th>Payload</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const editorHref = pathForEditor('components', item.slug);
                const isSelected = selected.has(item.slug);
                // Mirror ContentTable / TaxonomyView: clicking anywhere on
                // the row opens the editor unless the click landed on an
                // existing anchor / button / the select checkbox, and
                // modifier keys are passed through so cmd-click still opens
                // in a new tab.
                const onRowClick = (event: MouseEvent) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  if ((event.target as HTMLElement | null)?.closest('a, button, input, label'))
                    return;
                  event.preventDefault();
                  props.onEdit(item.slug);
                };
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: row click is a pointer-only affordance; the inner title and Detail anchors retain keyboard / screen-reader semantics
                  <tr
                    key={item.slug}
                    class="contentRow"
                    data-row-slug={item.slug}
                    data-selected={isSelected ? 'true' : 'false'}
                    onClick={onRowClick}
                  >
                    <td class="selectCell">
                      <input
                        type="checkbox"
                        class="rowSelect"
                        aria-label={`Select ${item.slug}`}
                        checked={isSelected}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => toggle(item.slug)}
                      />
                    </td>
                    <td class="titleCell">
                      <div class="titleLine">
                        <a
                          class="titleLink"
                          href={editorHref}
                          title={`{${item.slug}}`}
                          onClick={(event) => {
                            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                              return;
                            event.preventDefault();
                            props.onEdit(item.slug);
                          }}
                        >
                          <span class="titleText">{`{${item.slug}}`}</span>
                        </a>
                      </div>
                      {item.description ? <div class="meta">{item.description}</div> : null}
                      <div class="slugLine">
                        <span class="slug" dir="rtl" title={item.path}>
                          {item.path}
                        </span>
                      </div>
                    </td>
                    <td class="metaCell">
                      <span class="meta" aria-label="Payload">
                        {[item.hasHtml ? 'HTML' : null, item.hasCss ? 'CSS' : null]
                          .filter(Boolean)
                          .join(' · ') || 'empty'}
                      </span>
                    </td>
                    <td class="actionsCell">
                      <div class="rowActions">
                        <a
                          class="textLink textLinkStrong"
                          href={editorHref}
                          data-edit={item.slug}
                          onClick={(event) => {
                            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                              return;
                            event.preventDefault();
                            props.onEdit(item.slug);
                          }}
                        >
                          Detail
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : props.list.total === 0 ? (
        <StatePanel
          kind="empty"
          title="No components yet"
          message="Click New to register a {slug} snippet that posts and pages can embed."
        />
      ) : (
        <StatePanel
          kind="empty"
          title="No matching components"
          message="Clear the search to see all components."
        />
      )}
    </div>
  );
}
