// Ghost Koenig-style "+ insert" menu for the WYSIWYG editor.
//
// When the cursor sits on an empty top-level paragraph, a small `+`
// button floats in the left padding gutter of `.editorCanvas`
// (outside the writing column). Clicking it opens a popover with
// block-level insertions: Image (with upload), Bookmark (URL embed),
// Divider, Code block, Table.
//
// Pure ProseMirror Plugin / View — no Preact inside this file so the
// editor critical path stays free of UI framework wiring. The image
// uploader and OGP fetcher are injected via plugin options so api.ts
// coupling is kept at the component layer.
//
// Position math: we anchor the `+` vertically to the caret line via
// `view.coordsAtPos(from)`, and horizontally to a fixed offset to
// the left of `view.dom`'s bounding box — that way the button always
// lives in the gutter no matter how the editor is laid out, and we
// don't have to walk the DOM up looking for `.editorCanvas`.

import type { Node as ProseNode, Schema } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import {
  type ComponentEntry,
  type EmptyParagraphTarget,
  altFromFilenameDefault,
  build3x3Table,
  buildComponentParagraph,
  buildComponentSubmenuEntries,
  buildInsertComponentTransaction,
  findEmptyParagraph,
  nodeBy,
} from './prose-insert-menu-logic.ts';

export interface InsertMenuUploadResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface InsertMenuOptions {
  // Optional image uploader. When provided, the Image menu item is
  // enabled and triggers a hidden file input → upload → insert flow.
  // Without it, the Image item is hidden (so themes / harnesses that
  // don't have an upload endpoint don't surface a broken button).
  uploadImage?: (file: File) => Promise<InsertMenuUploadResult>;
  // Default alt-text prompt is suppressed in tests; the option lets
  // the runtime customise the source filename → alt translation.
  altFromFilename?: (name: string) => string;
  // Optional OGP fetcher. When provided, the Bookmark menu item is
  // enabled. The plugin stays decoupled from api.ts via this callback.
  fetchOgp?: (
    url: string,
  ) => Promise<{ ok: true; meta: Record<string, string> } | { ok: false; error: string }>;
  // Getter (not a static list) so the submenu picks up components
  // registered after the editor mounted without forcing a remount.
  // Returns the live set of `{slug}` snippets the post can embed; an
  // empty result hides the Components menu item entirely.
  getComponents?: () => ComponentEntry[];
}

// Replace the empty paragraph that holds the caret with the given
// block-level node. We replace the *paragraph itself*, not insert
// alongside it, so the empty line vanishes — matching Ghost Koenig
// behaviour where the `+` consumes the empty line.
function replaceEmptyParagraph(
  view: EditorView,
  target: EmptyParagraphTarget,
  insertion: ProseNode,
): void {
  const paraNode = view.state.doc.nodeAt(target.paraStart);
  if (!paraNode) return;
  const paraEnd = target.paraStart + paraNode.nodeSize;
  const tr = view.state.tr.replaceWith(target.paraStart, paraEnd, insertion);
  view.dispatch(tr.scrollIntoView());
}

// Inline image insertion — basic-schema image is inline, so we keep
// the surrounding paragraph and just drop the image at the caret.
// This preserves Markdown round-trip (`![alt](src)`).
function insertImageInline(
  view: EditorView,
  schema: Schema,
  attrs: { src: string; alt: string },
): void {
  const image = nodeBy(schema, 'image');
  if (!image) return;
  const node = image.create(attrs);
  const tr = view.state.tr.replaceSelectionWith(node, false).scrollIntoView();
  view.dispatch(tr);
}

// Replace the empty paragraph with a paragraph containing `{slug}`
// and dispatch the resulting transaction. The result reads identically
// to a hand-typed `{callout}` line, so the server-side shortcode
// expander treats both paths the same.
function insertComponentParagraph(
  view: EditorView,
  schema: Schema,
  target: EmptyParagraphTarget,
  component: ComponentEntry,
): void {
  const inserted = buildComponentParagraph(schema, component.slug, component);
  if (!inserted) return;
  const tr = buildInsertComponentTransaction(view.state, target, inserted);
  if (!tr) return;
  view.dispatch(tr.scrollIntoView());
}

interface SubmenuEntry {
  key: string;
  label: string;
  hint?: string;
  run: (view: EditorView, schema: Schema, target: EmptyParagraphTarget) => void;
}

interface InputViewSpec {
  placeholder: string;
  buttonLabel: string;
  validate(value: string): { ok: true; value: string } | { ok: false; error: string };
  run(
    view: EditorView,
    schema: Schema,
    target: EmptyParagraphTarget,
    value: string,
  ): Promise<{ ok: boolean; error?: string }>;
}

interface MenuItemSpec {
  key: string;
  label: string;
  hint: string;
  // Returns true if the item is currently available. Items return
  // false → hidden in the popover (we don't grey-out to keep the
  // surface clean).
  enabled: (schema: Schema, options: InsertMenuOptions) => boolean;
  // Items with a submenu defer their action to a flyout — the parent
  // `run` is unused in that case (kept for the action-style items
  // that fire on click). Submenu entries are rebuilt every time the
  // popover opens so live changes (newly registered components) show
  // up without a remount.
  submenu?: (options: InsertMenuOptions) => SubmenuEntry[];
  // Items with an inputView swap the popover body for a URL input on
  // click and only act once the user submits.
  inputView?: (options: InsertMenuOptions) => InputViewSpec;
  run?: (
    view: EditorView,
    schema: Schema,
    target: EmptyParagraphTarget,
    options: InsertMenuOptions,
    ui: { fileInput: HTMLInputElement; close: () => void },
  ) => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_url: 'Enter a valid http(s) URL',
  blocked: 'Cannot preview this URL',
  timeout: 'Preview timed out — inserted URL only',
  fetch_failed: 'Could not fetch — inserted URL only',
  no_metadata: 'No preview available — inserted URL only',
};

const MENU_ITEMS: MenuItemSpec[] = [
  {
    key: 'image',
    label: 'Image',
    hint: 'Upload an image from your computer',
    enabled: (schema, options) => Boolean(options.uploadImage) && Boolean(nodeBy(schema, 'image')),
    run(_view, _schema, _target, _options, ui) {
      ui.fileInput.value = '';
      ui.fileInput.click();
      ui.close();
    },
  },
  {
    key: 'bookmark',
    label: 'Bookmark',
    hint: 'Embed a URL as a rich link card',
    enabled: (schema, options) => Boolean(options.fetchOgp) && Boolean(nodeBy(schema, 'bookmark')),
    inputView: (options) => ({
      placeholder: 'Paste or type a URL',
      buttonLabel: 'Embed',
      // Mirrors validateBookmarkUrl in prose-insert-menu-logic.ts so the
      // plugin stays self-contained for tests / external embedders. Keep
      // the two in sync if either side's messages change.
      validate(value) {
        const trimmed = value.trim();
        if (!trimmed) return { ok: false, error: 'Enter a URL' };
        try {
          const u = new URL(trimmed);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            return { ok: false, error: 'Only http(s) URLs are supported' };
          }
          return { ok: true, value: u.toString() };
        } catch {
          return { ok: false, error: 'Enter a valid http(s) URL' };
        }
      },
      async run(view, schema, target, value) {
        const bookmark = nodeBy(schema, 'bookmark');
        if (!bookmark) return { ok: false, error: 'Bookmark node not registered' };
        const fetcher = options.fetchOgp;
        if (!fetcher) {
          replaceEmptyParagraph(view, target, bookmark.create({ url: value }));
          return { ok: false, error: 'No OGP fetcher configured' };
        }
        const result = await fetcher(value);
        if (result.ok) {
          replaceEmptyParagraph(view, target, bookmark.create({ url: value, ...result.meta }));
          return { ok: true };
        }
        replaceEmptyParagraph(view, target, bookmark.create({ url: value }));
        return {
          ok: false,
          error: ERROR_MESSAGES[result.error] ?? 'Could not fetch — inserted URL only',
        };
      },
    }),
  },
  {
    key: 'divider',
    label: 'Divider',
    hint: 'Horizontal rule between sections',
    enabled: (schema) => Boolean(nodeBy(schema, 'horizontal_rule')),
    run(view, schema, target, _options, ui) {
      const hr = nodeBy(schema, 'horizontal_rule');
      if (!hr) return;
      replaceEmptyParagraph(view, target, hr.create());
      ui.close();
      view.focus();
    },
  },
  {
    key: 'code-block',
    label: 'Code block',
    hint: 'Fenced code with monospaced font',
    enabled: (schema) => Boolean(nodeBy(schema, 'code_block')),
    run(view, schema, target, _options, ui) {
      const code = nodeBy(schema, 'code_block');
      if (!code) return;
      const filled = code.createAndFill();
      if (!filled) return;
      replaceEmptyParagraph(view, target, filled);
      ui.close();
      view.focus();
    },
  },
  {
    key: 'table',
    label: 'Table',
    hint: 'Insert a 3×3 table',
    enabled: (schema) => Boolean(nodeBy(schema, 'table')),
    run(view, schema, target, _options, ui) {
      const table = build3x3Table(schema);
      if (!table) return;
      replaceEmptyParagraph(view, target, table);
      ui.close();
      view.focus();
    },
  },
  {
    key: 'components',
    label: 'Components',
    hint: 'Embed a registered {slug} snippet',
    // Hide when the host hasn't wired a getter at all (theme harness,
    // tests) and when there are zero registered snippets — an empty
    // submenu would be a dead-end click target.
    enabled: (_schema, options) => {
      const list = options.getComponents?.() ?? [];
      return list.length > 0;
    },
    submenu(options) {
      const list = options.getComponents?.() ?? [];
      return buildComponentSubmenuEntries(list).map((entry) => ({
        key: entry.slug,
        label: entry.label,
        hint: entry.hint,
        run(view, schema, target) {
          insertComponentParagraph(view, schema, target, entry);
        },
      }));
    },
  },
];

export function insertMenuPlugin(schema: Schema, options: InsertMenuOptions = {}): Plugin {
  const opts: Required<Pick<InsertMenuOptions, 'altFromFilename'>> & InsertMenuOptions = {
    altFromFilename: options.altFromFilename ?? altFromFilenameDefault,
    uploadImage: options.uploadImage,
    fetchOgp: options.fetchOgp,
    getComponents: options.getComponents,
  };

  return new Plugin({
    view(view) {
      // ---- DOM nodes -------------------------------------------------
      const root = document.createElement('div');
      root.className = 'proseInsertMenu';
      root.style.position = 'fixed';
      root.style.visibility = 'hidden';
      root.style.pointerEvents = 'none';
      view.dom.parentElement?.appendChild(root);

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'proseInsertTrigger';
      trigger.setAttribute('aria-label', 'Insert block');
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.textContent = '+';
      root.appendChild(trigger);

      const popover = document.createElement('div');
      popover.className = 'proseInsertPopover';
      popover.setAttribute('role', 'menu');
      popover.hidden = true;
      root.appendChild(popover);

      const itemButtons: HTMLButtonElement[] = [];
      for (const item of MENU_ITEMS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'proseInsertItem';
        btn.dataset.key = item.key;
        btn.setAttribute('role', 'menuitem');
        if (item.submenu) {
          btn.dataset.hasSubmenu = 'true';
          btn.setAttribute('aria-haspopup', 'menu');
          btn.setAttribute('aria-expanded', 'false');
        }
        const label = document.createElement('span');
        label.className = 'proseInsertItemLabel';
        label.textContent = item.label;
        const hint = document.createElement('span');
        hint.className = 'proseInsertItemHint';
        hint.textContent = item.hint;
        btn.appendChild(label);
        btn.appendChild(hint);
        popover.appendChild(btn);
        itemButtons.push(btn);
      }

      // ---- Input view (for Bookmark and future inputView items) ------
      const inputView = document.createElement('div');
      inputView.className = 'proseInsertInputView';
      inputView.hidden = true;
      const inputLabel = document.createElement('input');
      inputLabel.type = 'url';
      inputLabel.className = 'proseInsertInputField';
      const inputSubmit = document.createElement('button');
      inputSubmit.type = 'button';
      inputSubmit.className = 'proseInsertInputSubmit';
      const inputError = document.createElement('div');
      inputError.className = 'proseInsertInputError';
      inputError.setAttribute('role', 'alert');
      inputView.appendChild(inputLabel);
      inputView.appendChild(inputSubmit);
      inputView.appendChild(inputError);
      popover.appendChild(inputView);

      // Flyout for items with a `submenu` — single shared DOM node
      // re-populated each time a submenu opens. Positioned fixed so
      // we can anchor it to the parent item's bounding rect without
      // fighting overflow on the popover.
      const submenu = document.createElement('div');
      submenu.className = 'proseInsertSubmenu';
      submenu.setAttribute('role', 'menu');
      submenu.hidden = true;
      submenu.style.position = 'fixed';
      root.appendChild(submenu);

      // ---- File input (image upload) ---------------------------------

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.className = 'proseInsertFileInput';
      fileInput.hidden = true;
      root.appendChild(fileInput);

      const originalTriggerTitle = trigger.title;
      let pendingTitleResetTimer: number | null = null;

      function clearPendingTitleReset(): void {
        if (pendingTitleResetTimer !== null) {
          window.clearTimeout(pendingTitleResetTimer);
          pendingTitleResetTimer = null;
        }
      }

      function flashTriggerError(message: string): void {
        clearPendingTitleReset();
        trigger.title = message;
        pendingTitleResetTimer = window.setTimeout(() => {
          pendingTitleResetTimer = null;
          trigger.title = originalTriggerTitle;
        }, 4000);
      }

      let currentTarget: EmptyParagraphTarget | null = null;
      let popoverOpen = false;
      let inputViewOpenKey: string | null = null;
      let submenuOpenKey: string | null = null;
      let closeSubmenuTimer: number | null = null;

      function clearCloseSubmenuTimer(): void {
        if (closeSubmenuTimer !== null) {
          window.clearTimeout(closeSubmenuTimer);
          closeSubmenuTimer = null;
        }
      }

      function closeSubmenu(): void {
        clearCloseSubmenuTimer();
        if (submenuOpenKey === null) return;
        submenu.hidden = true;
        submenu.replaceChildren();
        submenuOpenKey = null;
        for (const btn of itemButtons) {
          if (btn.dataset.hasSubmenu === 'true') {
            btn.setAttribute('aria-expanded', 'false');
            btn.dataset.submenuOpen = 'false';
          }
        }
      }

      function scheduleCloseSubmenu(delay = 180): void {
        clearCloseSubmenuTimer();
        closeSubmenuTimer = window.setTimeout(() => {
          closeSubmenu();
        }, delay);
      }

      function openSubmenu(
        itemKey: string,
        entries: SubmenuEntry[],
        anchorBtn: HTMLButtonElement,
      ): void {
        clearCloseSubmenuTimer();
        if (entries.length === 0) {
          closeSubmenu();
          return;
        }
        submenuOpenKey = itemKey;
        for (const btn of itemButtons) {
          if (btn.dataset.hasSubmenu === 'true') {
            const open = btn.dataset.key === itemKey;
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            btn.dataset.submenuOpen = open ? 'true' : 'false';
          }
        }
        submenu.replaceChildren();
        for (const entry of entries) {
          const sbtn = document.createElement('button');
          sbtn.type = 'button';
          sbtn.className = 'proseInsertSubmenuItem';
          sbtn.dataset.key = entry.key;
          sbtn.setAttribute('role', 'menuitem');
          const slabel = document.createElement('span');
          slabel.className = 'proseInsertSubmenuItemLabel';
          slabel.textContent = entry.label;
          sbtn.appendChild(slabel);
          if (entry.hint) {
            const shint = document.createElement('span');
            shint.className = 'proseInsertSubmenuItemHint';
            shint.textContent = entry.hint;
            sbtn.appendChild(shint);
          }
          sbtn.addEventListener('mousedown', (event) => {
            event.preventDefault();
          });
          sbtn.addEventListener('click', (event) => {
            event.preventDefault();
            const target = currentTarget;
            if (!target) {
              closeSubmenu();
              closePopover();
              return;
            }
            entry.run(view, schema, target);
            closeSubmenu();
            closePopover();
            view.focus();
          });
          submenu.appendChild(sbtn);
        }
        const popRect = popover.getBoundingClientRect();
        const btnRect = anchorBtn.getBoundingClientRect();
        submenu.hidden = false;
        // Reset before measuring so the previous content's height doesn't bleed into the geometry.
        submenu.style.left = `${popRect.right + 6}px`;
        submenu.style.top = `${btnRect.top}px`;
      }

      function openInputView(itemKey: string, spec: InputViewSpec): void {
        closeSubmenu();
        inputViewOpenKey = itemKey;
        inputLabel.value = '';
        inputLabel.placeholder = spec.placeholder;
        inputSubmit.textContent = spec.buttonLabel;
        inputSubmit.disabled = false;
        inputLabel.disabled = false;
        inputError.textContent = '';
        inputView.hidden = false;
        for (const btn of itemButtons) {
          btn.hidden = true;
        }
        setTimeout(() => inputLabel.focus(), 0);
      }

      function closeInputView(): void {
        if (inputViewOpenKey === null) return;
        inputViewOpenKey = null;
        inputView.hidden = true;
        update(view);
      }

      async function submitInputView(): Promise<void> {
        if (inputViewOpenKey === null) return;
        const item = MENU_ITEMS.find((i) => i.key === inputViewOpenKey);
        const spec = item?.inputView?.(opts);
        if (!spec || !currentTarget) {
          closeInputView();
          return;
        }
        const validation = spec.validate(inputLabel.value);
        if (!validation.ok) {
          inputError.textContent = validation.error;
          return;
        }
        inputError.textContent = '';
        inputLabel.disabled = true;
        inputSubmit.disabled = true;
        const result = await spec.run(view, schema, currentTarget, validation.value);
        inputLabel.disabled = false;
        inputSubmit.disabled = false;
        if (result.ok) {
          closeInputView();
          closePopover();
          view.focus();
          return;
        }
        closeInputView();
        closePopover();
        view.focus();
        if (result.error) {
          flashTriggerError(result.error);
        }
      }

      inputSubmit.addEventListener('mousedown', (event) => event.preventDefault());
      inputSubmit.addEventListener('click', (event) => {
        event.preventDefault();
        void submitInputView();
      });
      inputLabel.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void submitInputView();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          closeInputView();
        }
      });

      function openPopover(): void {
        if (popoverOpen) return;
        popoverOpen = true;
        popover.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        trigger.dataset.open = 'true';
      }

      function closePopover(): void {
        if (!popoverOpen) return;
        closeInputView();
        closeSubmenu();
        popoverOpen = false;
        popover.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        trigger.dataset.open = 'false';
      }

      async function runUpload(file: File): Promise<void> {
        const uploader = opts.uploadImage;
        if (!uploader) return;
        if (!currentTarget) return;
        const result = await uploader(file);
        if (!result.ok || !result.path) {
          // Surface upload errors via the trigger title — the
          // dashboard's notice strip is the more user-visible
          // channel, but we don't have access to it here. Console
          // is fine as a fallback for now.
          // eslint-disable-next-line no-console
          console.error('insert-menu: image upload failed', result.error);
          return;
        }
        // Insert at the current selection. The doc may have changed
        // while the upload was in flight (the user could have typed,
        // moved, deleted), so we trust the live cursor instead of
        // trying to re-anchor to the original empty paragraph.
        insertImageInline(view, schema, {
          src: result.path,
          alt: opts.altFromFilename(file.name),
        });
        view.focus();
      }

      fileInput.addEventListener('change', () => {
        const f = fileInput.files?.[0];
        if (!f) return;
        void runUpload(f);
      });

      trigger.addEventListener('mousedown', (event) => {
        event.preventDefault(); // don't steal focus from the editor
      });
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        if (popoverOpen) {
          closePopover();
        } else {
          openPopover();
        }
      });

      for (let i = 0; i < itemButtons.length; i += 1) {
        const btn = itemButtons[i];
        const item = MENU_ITEMS[i];
        if (!btn || !item) continue;
        btn.addEventListener('mousedown', (event) => {
          event.preventDefault();
        });
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          const target = currentTarget;
          if (!target) {
            closePopover();
            return;
          }
          if (item.inputView) {
            const spec = item.inputView(opts);
            openInputView(item.key, spec);
            return;
          }
          if (item.submenu) {
            // Toggle: clicking the same item closes the submenu, a fresh
            // click on a different submenu-enabled item swaps the flyout.
            const entries = item.submenu(opts);
            if (submenuOpenKey === item.key) {
              closeSubmenu();
            } else {
              openSubmenu(item.key, entries, btn);
            }
            return;
          }
          if (item.run) {
            item.run(view, schema, target, opts, { fileInput, close: closePopover });
          }
        });
        // Hover affordance: entering a submenu-bearing item opens the
        // flyout; entering a flat item closes any pending one. Leaving
        // the popover schedules a close that the submenu's own
        // mouseenter cancels, so the user can sweep diagonally without
        // losing the menu.
        btn.addEventListener('mouseenter', () => {
          if (item.submenu) {
            const entries = item.submenu(opts);
            openSubmenu(item.key, entries, btn);
          } else if (submenuOpenKey !== null) {
            scheduleCloseSubmenu(120);
          }
        });
      }

      popover.addEventListener('mouseleave', () => {
        if (submenuOpenKey !== null) scheduleCloseSubmenu(180);
      });
      popover.addEventListener('mouseenter', () => {
        clearCloseSubmenuTimer();
      });
      submenu.addEventListener('mouseenter', () => {
        clearCloseSubmenuTimer();
      });
      submenu.addEventListener('mouseleave', () => {
        scheduleCloseSubmenu(180);
      });

      function onDocumentMousedown(event: MouseEvent) {
        if (!popoverOpen) return;
        const t = event.target;
        if (t instanceof Node && root.contains(t)) return;
        closePopover();
      }
      document.addEventListener('mousedown', onDocumentMousedown);

      function onKeyDown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
          // `onKeyDown` runs in the document capture phase first. When the
          // input view is open we early-return so the popover-wide Escape
          // doesn't close it; the input field's own bubble-phase keydown
          // handler then closes only the input view.
          if (inputViewOpenKey !== null) return;
          if (submenuOpenKey !== null) {
            event.stopPropagation();
            closeSubmenu();
            return;
          }
          if (popoverOpen) {
            event.stopPropagation();
            closePopover();
            view.focus();
          }
        }
      }
      document.addEventListener('keydown', onKeyDown, true);

      function update(currentView: EditorView): void {
        const target = findEmptyParagraph(currentView.state);
        const focused = currentView.hasFocus() || popoverOpen;
        if (!target || !focused) {
          root.style.visibility = 'hidden';
          root.style.pointerEvents = 'none';
          currentTarget = null;
          if (popoverOpen) closePopover();
          return;
        }
        currentTarget = target;

        // When the input view is open, leave item buttons as-is —
        // they are already hidden by openInputView and should not
        // be reshown while the user is filling in the input.
        if (inputViewOpenKey === null) {
          // Apply per-item enabled state. Items disabled by missing
          // schema nodes or absent uploader get hidden — we don't
          // grey them out to keep the surface unambiguous.
          for (let i = 0; i < MENU_ITEMS.length; i += 1) {
            const item = MENU_ITEMS[i];
            const btn = itemButtons[i];
            if (!item || !btn) continue;
            btn.hidden = !item.enabled(schema, opts);
          }
        }

        // Anchor: line top of the empty paragraph + horizontal offset
        // from `view.dom`'s left edge, pushed into the gutter.
        const coords = currentView.coordsAtPos(target.caretPos, 1);
        const lineHeight = Math.max(coords.bottom - coords.top, 18);
        const proseRect = currentView.dom.getBoundingClientRect();
        const buttonSize = 28;
        const gutterGap = 12;
        let left = proseRect.left - buttonSize - gutterGap;
        // If the available gutter is too narrow (e.g. mobile where
        // `.editorCanvas` collapses), tuck the button just inside
        // the prose column at the left edge. The visual cost is
        // small; without this the button would fall off-screen.
        if (left < 8) {
          left = Math.max(8, proseRect.left + 4);
        }
        const top = coords.top + (lineHeight - buttonSize) / 2;
        root.style.visibility = 'visible';
        root.style.pointerEvents = 'auto';
        root.style.left = `${left}px`;
        root.style.top = `${top}px`;
      }

      update(view);
      return {
        update(currentView) {
          update(currentView);
        },
        destroy() {
          clearPendingTitleReset();
          clearCloseSubmenuTimer();
          document.removeEventListener('mousedown', onDocumentMousedown);
          document.removeEventListener('keydown', onKeyDown, true);
          root.remove();
        },
      };
    },
  });
}
