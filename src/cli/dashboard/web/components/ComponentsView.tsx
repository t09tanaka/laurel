import type { JSX } from 'preact';
import { matches } from '../lib/format.ts';
import { pathForEditor } from '../lib/routes.ts';
import type { ComponentSummary, DashboardList } from '../types.ts';
import { StatePanel } from './StatePanel.tsx';

// Read-only list of reusable {slug} component snippets. Mirrors the
// posts / pages / taxonomy table conventions so the row affordances are
// familiar: click anywhere on the row to open the editor, hover surfaces
// a right-aligned Detail link, mono slug + faint metadata.
interface ComponentsViewProps {
  list: DashboardList<ComponentSummary>;
  query: string;
  onEdit: (slug: string) => void;
}

export function ComponentsView(props: ComponentsViewProps): JSX.Element {
  const q = props.query.toLowerCase();
  const items = props.list.items.filter((item) =>
    matches(`${item.slug} ${item.description} ${item.path}`, q),
  );
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
        </div>
      </div>
      {items.length ? (
        <div class="tableWrap">
          <table class="table">
            <thead class="srOnly">
              <tr>
                <th>Slug</th>
                <th>Payload</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const editorHref = pathForEditor('components', item.slug);
                // Mirror ContentTable / TaxonomyView: clicking anywhere on
                // the row opens the editor unless the click landed on an
                // existing anchor / button (the inner title link or the
                // Detail link in the actions cell), and modifier keys are
                // passed through so cmd-click still opens in a new tab.
                const onRowClick = (event: MouseEvent) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  if ((event.target as HTMLElement | null)?.closest('a, button')) return;
                  event.preventDefault();
                  props.onEdit(item.slug);
                };
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: row click is a pointer-only affordance; the inner title and Detail anchors retain keyboard / screen-reader semantics
                  <tr
                    key={item.slug}
                    class="contentRow"
                    data-row-slug={item.slug}
                    onClick={onRowClick}
                  >
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
      ) : (
        <StatePanel
          kind="empty"
          message={
            props.list.total === 0
              ? 'No components yet. Click New to register a {slug} snippet that posts and pages can embed.'
              : 'No matches for the current filter.'
          }
        />
      )}
    </div>
  );
}
