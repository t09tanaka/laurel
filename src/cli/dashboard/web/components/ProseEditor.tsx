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
import { type NodeType, Schema } from 'prosemirror-model';
import {
  addListNodes,
  liftListItem,
  sinkListItem,
  splitListItem,
  wrapInList,
} from 'prosemirror-schema-list';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { type Command, EditorState, type Transaction } from 'prosemirror-state';
import { goToNextCell, tableEditing, tableNodes } from 'prosemirror-tables';
import { EditorView } from 'prosemirror-view';
import { bubbleMenuPlugin } from '../lib/prose-bubble-menu.ts';
import { buildInputRules } from '../lib/prose-input-rules.ts';

// Wide schema: paragraph / blockquote / heading / horizontal_rule /
// code_block / image / hard_break + lists + tables, plus the basic
// inline marks (em / strong / link / code).
const baseNodes = basicSchema.spec.nodes;
const withList = addListNodes(baseNodes, 'paragraph block*', 'block');
const fullNodes = withList.append(
  tableNodes({
    tableGroup: 'block',
    cellContent: 'block+',
    cellAttributes: {},
  }),
);

export const proseSchema = new Schema({
  nodes: fullNodes,
  marks: basicSchema.spec.marks,
});

function node(name: string): NodeType {
  const t = proseSchema.nodes[name];
  if (!t) throw new Error(`prose schema missing node: ${name}`);
  return t;
}

// Markdown parser adapted to the wider schema. prosemirror-markdown
// doesn't ship a built-in table token handler so we wire the relevant
// markdown-it tokens (table_open / thead / tbody / tr / th / td) here.
const parserTokens = { ...defaultMarkdownParser.tokens };
parserTokens.table_open = { block: 'table' };
parserTokens.thead_open = { ignore: true };
parserTokens.thead_close = { ignore: true };
parserTokens.tbody_open = { ignore: true };
parserTokens.tbody_close = { ignore: true };
parserTokens.tr_open = { block: 'table_row' };
parserTokens.tr_close = { ignore: true };
parserTokens.th_open = { block: 'table_header' };
parserTokens.th_close = { ignore: true };
parserTokens.td_open = { block: 'table_cell' };
parserTokens.td_close = { ignore: true };

export const markdownParser = new MarkdownParser(
  proseSchema,
  defaultMarkdownParser.tokenizer,
  parserTokens,
);

// Tables don't have a stock markdown serializer either. We walk rows
// and cells, serialise each cell's inline children with the default
// node serializer, and emit GFM-style pipe tables.
const baseSerializer = defaultMarkdownSerializer;

function serializeCell(cell: import('prosemirror-model').Node): string {
  const inner = new MarkdownSerializer(baseSerializer.nodes, baseSerializer.marks)
    .serialize(cell)
    .replace(/\n+/g, ' ')
    .trim();
  return inner.length === 0 ? ' ' : inner.replace(/\|/g, '\\|');
}

export const markdownSerializer = new MarkdownSerializer(
  {
    ...baseSerializer.nodes,
    table(state, n) {
      const rows: string[][] = [];
      n.forEach((row) => {
        const cells: string[] = [];
        row.forEach((cell) => {
          cells.push(serializeCell(cell));
        });
        rows.push(cells);
      });
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
  },
  baseSerializer.marks,
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
      ],
    });
    const view = new EditorView(host, {
      state,
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
