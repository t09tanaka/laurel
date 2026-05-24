import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_EDITOR_FOCUS_STATE,
  type EditorFocusState,
  reduceEditorFocus,
  saveStateFromFlags,
} from '../../../src/cli/dashboard/editor-focus.ts';

describe('editor-focus reducer — defaults and focus/metadata toggles', () => {
  test('DEFAULT_EDITOR_FOCUS_STATE has focusMode=true, metadataExpanded=false, saveState=idle', () => {
    expect(DEFAULT_EDITOR_FOCUS_STATE.focusMode).toBe(true);
    expect(DEFAULT_EDITOR_FOCUS_STATE.metadataExpanded).toBe(false);
    expect(DEFAULT_EDITOR_FOCUS_STATE.saveState).toBe('idle');
  });

  test('focus/toggle flips focusMode round-trip', () => {
    const once = reduceEditorFocus(DEFAULT_EDITOR_FOCUS_STATE, { type: 'focus/toggle' });
    expect(once.focusMode).toBe(false);
    const twice = reduceEditorFocus(once, { type: 'focus/toggle' });
    expect(twice.focusMode).toBe(true);
  });

  test('focus/set to current value preserves identity (no churn)', () => {
    const next = reduceEditorFocus(DEFAULT_EDITOR_FOCUS_STATE, {
      type: 'focus/set',
      value: true,
    });
    expect(next).toBe(DEFAULT_EDITOR_FOCUS_STATE);
  });

  test('focus/set to a new value returns a new state with focusMode updated', () => {
    const next = reduceEditorFocus(DEFAULT_EDITOR_FOCUS_STATE, {
      type: 'focus/set',
      value: false,
    });
    expect(next).not.toBe(DEFAULT_EDITOR_FOCUS_STATE);
    expect(next.focusMode).toBe(false);
  });

  test('metadata/toggle flips metadataExpanded', () => {
    const once = reduceEditorFocus(DEFAULT_EDITOR_FOCUS_STATE, { type: 'metadata/toggle' });
    expect(once.metadataExpanded).toBe(true);
    const twice = reduceEditorFocus(once, { type: 'metadata/toggle' });
    expect(twice.metadataExpanded).toBe(false);
  });

  test('metadata/set to current value preserves identity', () => {
    const next = reduceEditorFocus(DEFAULT_EDITOR_FOCUS_STATE, {
      type: 'metadata/set',
      value: false,
    });
    expect(next).toBe(DEFAULT_EDITOR_FOCUS_STATE);
  });

  test('toggling metadata does not affect focusMode or saveState', () => {
    const next = reduceEditorFocus(DEFAULT_EDITOR_FOCUS_STATE, { type: 'metadata/toggle' });
    expect(next.focusMode).toBe(DEFAULT_EDITOR_FOCUS_STATE.focusMode);
    expect(next.saveState).toBe(DEFAULT_EDITOR_FOCUS_STATE.saveState);
  });
});

describe('editor-focus reducer — save state transitions', () => {
  test('save/state transitions dirty → saving → saved → idle preserve other fields', () => {
    const start: EditorFocusState = { ...DEFAULT_EDITOR_FOCUS_STATE, focusMode: false };
    const dirty = reduceEditorFocus(start, { type: 'save/state', value: 'dirty' });
    expect(dirty.saveState).toBe('dirty');
    expect(dirty.focusMode).toBe(false);
    expect(dirty.metadataExpanded).toBe(start.metadataExpanded);

    const saving = reduceEditorFocus(dirty, { type: 'save/state', value: 'saving' });
    expect(saving.saveState).toBe('saving');
    expect(saving.focusMode).toBe(false);

    const saved = reduceEditorFocus(saving, { type: 'save/state', value: 'saved' });
    expect(saved.saveState).toBe('saved');
    expect(saved.focusMode).toBe(false);

    const idle = reduceEditorFocus(saved, { type: 'save/state', value: 'idle' });
    expect(idle.saveState).toBe('idle');
    expect(idle.focusMode).toBe(false);
  });

  test('save/state to the same value preserves identity', () => {
    const next = reduceEditorFocus(DEFAULT_EDITOR_FOCUS_STATE, {
      type: 'save/state',
      value: 'idle',
    });
    expect(next).toBe(DEFAULT_EDITOR_FOCUS_STATE);
  });
});

describe('saveStateFromFlags', () => {
  test('all flags off returns idle', () => {
    expect(saveStateFromFlags({ dirty: false, saving: false })).toBe('idle');
  });

  test('dirty only returns dirty', () => {
    expect(saveStateFromFlags({ dirty: true, saving: false })).toBe('dirty');
  });

  test('saving only returns saving', () => {
    expect(saveStateFromFlags({ dirty: false, saving: true })).toBe('saving');
  });

  test('recentlySaved with nothing else returns saved', () => {
    expect(saveStateFromFlags({ dirty: false, saving: false, recentlySaved: true })).toBe('saved');
  });

  test('error wins over saving and dirty', () => {
    expect(saveStateFromFlags({ dirty: true, saving: true, error: true })).toBe('error');
  });

  test('saving wins over dirty when both set', () => {
    expect(saveStateFromFlags({ dirty: true, saving: true })).toBe('saving');
  });
});
