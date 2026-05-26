import MarkdownIt from 'markdown-it';
import type { JSX, Ref } from 'preact';
import { useEffect, useImperativeHandle, useRef } from 'preact/hooks';
import {
  baseKeymap,
  chainCommands,
  exitCode,
  joinUp,
  lift,
  setBlockType,
  toggleMark,
  wrapIn,
} from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { undoInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from 'prosemirror-markdown';
import { type MarkSpec, type NodeType, Schema } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import {
  addListNodes,
  liftListItem,
  sinkListItem,
  splitListItem,
  wrapInList,
} from 'prosemirror-schema-list';
import { type Command, EditorState, type Transaction } from 'prosemirror-state';
import { goToNextCell, tableEditing, tableNodes } from 'prosemirror-tables';
import { EditorView } from 'prosemirror-view';
import { uploadImage } from '../lib/api.ts';
import {
  bookmarkMarkdownItPlugin,
  bookmarkSerializerNode,
  bookmarkTokenHandler,
} from '../lib/prose-bookmark-markdown.ts';
import { bookmarkNodeSpec } from '../lib/prose-bookmark-schema.ts';
import { bubbleMenuPlugin } from '../lib/prose-bubble-menu.ts';
import { ImageNodeView } from '../lib/prose-image-view.ts';
import { buildInputRules } from '../lib/prose-input-rules.ts';
import { insertMenuPlugin } from '../lib/prose-insert-menu.ts';

// Wide schema: paragraph / blockquote / heading / horizontal_rule /
// code_block / image / hard_break + lists + tables, plus the basic
// inline marks (em / strong / link / code).
const baseNodes = basicSchema.spec.nodes;
const withList = addListNodes(baseNodes, 'paragraph block*', 'block');
// `cellContent: 'inline*'` lets markdown's inline tokens (text, em,
// strong, code, links) land directly inside `table_header` /
// `table_cell` without forcing an extra paragraph wrapper — which
// matches the GFM model and keeps serialise → parse → serialise
// stable.
const fullNodes = withList.append(
  tableNodes({
    tableGroup: 'block',
    cellContent: 'inline*',
    cellAttributes: {},
  }),
);

const fullNodesWithBookmark = fullNodes.append({ bookmark: bookmarkNodeSpec });

const strikethroughMark: MarkSpec = {
  parseDOM: [{ tag: 's' }, { tag: 'strike' }, { tag: 'del' }],
  toDOM() {
    return ['s', 0];
  },
};
const extendedMarks = basicSchema.spec.marks.addToEnd('strikethrough', strikethroughMark);

export const proseSchema = new Schema({
  nodes: fullNodesWithBookmark,
  marks: extendedMarks,
});

function node(name: string): NodeType {
  const t = proseSchema.nodes[name];
  if (!t) throw new Error(`prose schema missing node: ${name}`);
  return t;
}

// Markdown parser adapted to the wider schema. prosemirror-markdown
// doesn't ship built-in token handlers for tables or strikethrough.
// NOTE: prosemirror-markdown keys block / mark specs by the *base*
// token name (e.g. `table`, `tr`) and auto-derives `_open` / `_close`
// handlers from it — wiring `table_open` directly would never match.
const parserTokens = {
  ...defaultMarkdownParser.tokens,
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: { block: 'table_header' },
  td: { block: 'table_cell' },
  s: { mark: 'strikethrough' },
  bookmark: bookmarkTokenHandler,
};

// prosemirror-markdown's `defaultMarkdownParser` is built on the
// `commonmark` preset, which leaves the GFM `table` rule turned OFF.
// Run our own MarkdownIt instance with `table` re-enabled so the
// tokens above actually fire.
const markdownTokenizer = MarkdownIt('commonmark', { html: false })
  .enable(['table'])
  .use(bookmarkMarkdownItPlugin);

export const markdownParser = new MarkdownParser(proseSchema, markdownTokenizer, parserTokens);

// Tables don't have a stock markdown serializer either. We walk rows
// and cells, serialise each cell's inline children with the default
// node serializer, and emit GFM-style pipe tables.
const baseSerializer = defaultMarkdownSerializer;

function serializeCell(cell: import('prosemirror-model').Node): string {
  // Cells contain `block+` (usually a single paragraph). For a pipe-table
  // cell we want each paragraph's inline content flattened onto one line.
  // We do that via a one-off serializer whose `paragraph` rule just calls
  // `renderInline` instead of emitting block-level delimiters — that way
  // marks (em / strong / code / link / strikethrough) survive the trip
  // without us reaching into MarkdownSerializerState's private surface.
  const cellSerializer = new MarkdownSerializer(
    {
      ...baseSerializer.nodes,
      paragraph: (state, node) => state.renderInline(node),
    },
    baseSerializer.marks,
  );
  const inner = cellSerializer.serialize(cell).replace(/\n+/g, ' ').trim();
  return inner.length === 0 ? ' ' : inner.replace(/\|/g, '\\|');
}

export const markdownSerializer = new MarkdownSerializer(
  {
    ...baseSerializer.nodes,
    table(state, n) {
      const rows: string[][] = [];
      for (let r = 0; r < n.childCount; r += 1) {
        const row = n.child(r);
        const cells: string[] = [];
        for (let c = 0; c < row.childCount; c += 1) {
          cells.push(serializeCell(row.child(c)));
        }
        rows.push(cells);
      }
      if (rows.length === 0) return;
      const header = rows[0] ?? [];
      const cols = header.length;
      state.write(`| ${header.join(' | ')} |\n`);
      state.write(`| ${Array.from({ length: cols }, () => '---').join(' | ')} |\n`);
      for (let i = 1; i < rows.length; i += 1) {
        const row = rows[i] ?? [];
        state.write(`| ${row.join(' | ')} |\n`);
      }
      state.closeBlock(n);
    },
    table_row() {
      /* handled by table */
    },
    table_header() {
      /* handled by table */
    },
    table_cell() {
      /* handled by table */
    },
    bookmark: bookmarkSerializerNode,
  },
  {
    ...baseSerializer.marks,
    strikethrough: {
      open: '~~',
      close: '~~',
      mixable: true,
      expelEnclosingWhitespace: true,
    },
  },
);

export interface ProseEditorHandle {
  getMarkdown: () => string;
  focus: () => void;
}

interface ProseEditorProps {
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  resetKey?: string | number;
  handleRef?: Ref<ProseEditorHandle | null>;
}

function commandKeymap(): Record<string, Command> {
  const marks = proseSchema.marks;
  const cmd = (name: string): Command => {
    const m = marks[name];
    if (!m) throw new Error(`prose schema missing mark: ${name}`);
    return toggleMark(m);
  };
  const hardBreak = node('hard_break');
  const map: Record<string, Command> = {
    'Mod-z': undo,
    'Shift-Mod-z': redo,
    'Mod-y': redo,
    Backspace: undoInputRule,
    'Mod-b': cmd('strong'),
    'Mod-i': cmd('em'),
    'Mod-`': cmd('code'),
    'Mod-Shift-s': cmd('strikethrough'),
    'Shift-Ctrl-8': wrapInList(node('bullet_list')),
    'Shift-Ctrl-9': wrapInList(node('ordered_list')),
    'Shift-Ctrl-0': setBlockType(node('paragraph')),
    'Mod-Enter': chainCommands(exitCode, (state, dispatch) => {
      if (dispatch) dispatch(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
      return true;
    }),
    Enter: splitListItem(node('list_item')),
    'Mod-[': liftListItem(node('list_item')),
    'Mod-]': sinkListItem(node('list_item')),
    'Alt-ArrowUp': joinUp,
    'Mod-BracketLeft': lift,
    'Shift-Ctrl->': wrapIn(node('blockquote')),
    Tab: goToNextCell(1),
    'Shift-Tab': goToNextCell(-1),
  };
  for (let i = 1; i <= 6; i += 1) {
    map[`Shift-Ctrl-${i}`] = setBlockType(node('heading'), { level: i });
  }
  return map;
}

export function ProseEditor(props: ProseEditorProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;

  useImperativeHandle<ProseEditorHandle | null, ProseEditorHandle | null>(
    props.handleRef ?? { current: null },
    () => ({
      getMarkdown(): string {
        const view = viewRef.current;
        return view ? markdownSerializer.serialize(view.state.doc) : '';
      },
      focus(): void {
        viewRef.current?.focus();
      },
    }),
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional fresh mount
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let doc = markdownParser.parse(props.initialMarkdown ?? '');
    if (!doc) {
      const filled = proseSchema.topNodeType.createAndFill();
      if (!filled) return;
      doc = filled;
    }
    const state = EditorState.create({
      doc,
      schema: proseSchema,
      plugins: [
        buildInputRules(proseSchema),
        keymap(commandKeymap()),
        keymap(baseKeymap),
        history(),
        tableEditing(),
        bubbleMenuPlugin(proseSchema),
        insertMenuPlugin(proseSchema, {
          uploadImage: async (file) => {
            const result = await uploadImage(file);
            if (result.ok) return { ok: true, path: result.path };
            return { ok: false, error: result.error };
          },
        }),
      ],
    });
    const view = new EditorView(host, {
      state,
      nodeViews: {
        image: (n, v, getPos) => new ImageNodeView(n, v, getPos),
      },
      dispatchTransaction(tr: Transaction) {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) {
          onChangeRef.current(markdownSerializer.serialize(next.doc));
        }
      },
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [props.resetKey]);

  return <div class="proseHost" ref={hostRef} spellcheck />;
}
