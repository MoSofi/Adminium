// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Code tab's editor: one view, and a state for each file that has been
 * opened, kept while the tab lives. So a file's undo history and caret are its
 * own, and opening another file loses nothing typed in the first.
 *
 * It is told what to show and whether it may be changed; it says when a
 * file's text changed, when the person asks to save, and when they leave it.
 * It reads and writes no file itself.
 */
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';

import { languageFor } from './languages.js';
import { editorLook, HELD_CLASS } from './theme.js';

export interface CodeEditorEvents {
  /** A file's text is now this (after typing, an undo, or a discard). */
  onChange: (path: string, text: string) => void;
  /** Ctrl+S or Cmd+S inside the editor. */
  onSave: () => void;
  /** Escape: the keyboard's way out, since Tab types here. */
  onLeave: () => void;
}

export interface CodeEditor {
  /** Show a file. The first time, from `text`; after that, as it was left. */
  open: (path: string, text: string) => void;
  /** The file being shown, or null. */
  shown: () => string | null;
  /** A file's text as the editor holds it, or null when it was never opened. */
  text: (path: string) => string | null;
  /** Put another text in a file's place as ONE change the person can undo. */
  replace: (path: string, text: string) => void;
  /** Start a file again from `text`: what was typed and its history are gone (the file changed on disk). */
  reset: (path: string, text: string) => void;
  forget: (path: string) => void;
  /** Held, the text can be read, selected and reached by keyboard, and not changed. */
  setHeld: (held: boolean) => void;
  /** What the editor is called to a screen reader. */
  setLabel: (label: string) => void;
  focus: () => void;
  destroy: () => void;
}

export function createCodeEditor(parent: HTMLElement, events: CodeEditorEvents): CodeEditor {
  const states = new Map<string, EditorState>();
  const hold = new Compartment();
  const name = new Compartment();
  let current: string | null = null;
  let held = false;
  let label = '';

  const holdValue = () => [EditorState.readOnly.of(held), EditorView.editorAttributes.of(held ? { class: HELD_CLASS } : {})];
  const nameValue = () => EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true' });

  const stateFor = (path: string, text: string): EditorState =>
    EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        keymap.of([
          { key: 'Mod-s', preventDefault: true, run: () => (events.onSave(), true) },
          { key: 'Escape', run: () => (events.onLeave(), true) },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        languageFor(path),
        editorLook,
        hold.of(holdValue()),
        name.of(nameValue()),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) events.onChange(path, update.state.doc.toString());
        }),
      ],
    });

  const view = new EditorView({ parent });

  /** The view's state is the file's newest: kept before another is shown. */
  const keep = (): void => {
    if (current !== null) states.set(current, view.state);
  };
  const show = (path: string, state: EditorState): void => {
    keep();
    current = path;
    states.set(path, state);
    view.setState(state);
    // A state made or kept under another hold or name is brought to this one.
    view.dispatch({ effects: [hold.reconfigure(holdValue()), name.reconfigure(nameValue())] });
  };

  return {
    open: (path, text) => {
      if (path === current) return;
      show(path, states.get(path) ?? stateFor(path, text));
    },
    shown: () => current,
    text: (path) => (path === current ? view.state : states.get(path))?.doc.toString() ?? null,
    replace: (path, text) => {
      const state = path === current ? view.state : states.get(path);
      if (state === undefined) return;
      // The page's own act (a discard), not typing: a hold stops the keys, not this.
      const change = { changes: { from: 0, to: state.doc.length, insert: text }, userEvent: 'input.replace' };
      if (path === current) {
        view.dispatch(change);
        return;
      }
      const next = state.update(change).state;
      states.set(path, next);
      events.onChange(path, next.doc.toString());
    },
    reset: (path, text) => {
      const fresh = stateFor(path, text);
      if (path === current) {
        current = null;
        show(path, fresh);
      } else states.set(path, fresh);
    },
    forget: (path) => {
      states.delete(path);
      if (path === current) current = null;
    },
    setHeld: (value) => {
      if (value === held) return;
      held = value;
      view.dispatch({ effects: hold.reconfigure(holdValue()) });
    },
    setLabel: (value) => {
      if (value === label) return;
      label = value;
      view.dispatch({ effects: name.reconfigure(nameValue()) });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
