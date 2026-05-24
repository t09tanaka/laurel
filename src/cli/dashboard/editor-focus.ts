// Pure reducer + types for the editor focus mode UI slice. Lives outside the
// Preact bundle so the state machine is testable under `bun test` without
// touching DOM types.

export type EditorSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface EditorFocusState {
  focusMode: boolean;
  metadataExpanded: boolean;
  saveState: EditorSaveState;
}

export const DEFAULT_EDITOR_FOCUS_STATE: EditorFocusState = {
  focusMode: true,
  metadataExpanded: false,
  saveState: 'idle',
};

export type EditorFocusAction =
  | { type: 'focus/toggle' }
  | { type: 'focus/set'; value: boolean }
  | { type: 'metadata/toggle' }
  | { type: 'metadata/set'; value: boolean }
  | { type: 'save/state'; value: EditorSaveState };

export function reduceEditorFocus(
  state: EditorFocusState,
  action: EditorFocusAction,
): EditorFocusState {
  switch (action.type) {
    case 'focus/toggle':
      return { ...state, focusMode: !state.focusMode };
    case 'focus/set':
      return state.focusMode === action.value ? state : { ...state, focusMode: action.value };
    case 'metadata/toggle':
      return { ...state, metadataExpanded: !state.metadataExpanded };
    case 'metadata/set':
      return state.metadataExpanded === action.value
        ? state
        : { ...state, metadataExpanded: action.value };
    case 'save/state':
      return state.saveState === action.value ? state : { ...state, saveState: action.value };
  }
}

export function saveStateFromFlags(opts: {
  dirty: boolean;
  saving: boolean;
  error?: boolean;
  recentlySaved?: boolean;
}): EditorSaveState {
  if (opts.error) return 'error';
  if (opts.saving) return 'saving';
  if (opts.dirty) return 'dirty';
  if (opts.recentlySaved) return 'saved';
  return 'idle';
}
