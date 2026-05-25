// Pure helpers used by the bubble menu. Kept DOM-free so they can be
// pulled into the test suite without dragging the DOM-touching plugin
// surface into the root tsconfig (which excludes the dashboard/web
// tree to keep DOM types out of the SSG build).

import type { Node as ProseNode } from 'prosemirror-model';
import { type EditorState, NodeSelection } from 'prosemirror-state';

// Returns the selected image node + its document position when the
// current selection is a NodeSelection on an `image` node, or null
// otherwise. Used to drive the image-edit row of the bubble menu.
export function getImageSelection(state: EditorState): { node: ProseNode; pos: number } | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === 'image') {
    return { node: sel.node, pos: sel.from };
  }
  return null;
}
