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
import { Compartment, EditorSelection, EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';

import { findRanges, type FindRange, type FindSpec } from './find.js';

import { languageFor } from './languages.js';
import { editorLook, FOUND_AT_CLASS, FOUND_CLASS, HELD_CLASS } from './theme.js';

export interface CodeEditorEvents {
  /** A file's text is now this (after typing, an undo, or a discard). */
  onChange: (path: string, text: string) => void;
  /** Ctrl+S or Cmd+S inside the editor. */
  onSave: () => void;
  /** Escape: the keyboard's way out, since Tab types here. */
  onLeave: () => void;
  /** What is being looked for was found this many times in the file shown; `at` is the one the selection is on (from 0), or -1. */
  onFound?: (found: { count: number; at: number; more: boolean }) => void;
}

/** What is looked for in a file, the places it is, and which of them the selection is on. */
interface Found {
  spec: FindSpec | null;
  ranges: readonly FindRange[];
  more: boolean;
  at: number;
  marks: DecorationSet;
}
const setFind = StateEffect.define<FindSpec | null>();
const foundMark = Decoration.mark({ class: FOUND_CLASS });
const foundAtMark = Decoration.mark({ class: `${FOUND_CLASS} ${FOUND_AT_CLASS}` });
const found = StateField.define<Found>({
  create: () => ({ spec: null, ranges: [], more: false, at: -1, marks: Decoration.none }),
  update(value, tr) {
    let spec = value.spec;
    let asked = false;
    for (const effect of tr.effects) {
      if (!effect.is(setFind)) continue;
      spec = effect.value;
      asked = true;
    }
    if (!asked && !tr.docChanged && tr.selection === undefined) return value;
    const looked = asked || tr.docChanged;
    const { ranges, more } = !looked ? value : spec === null ? { ranges: [], more: false } : findRanges(tr.newDoc.toString(), spec);
    const { from, to } = tr.newSelection.main;
    const at = ranges.findIndex((range) => range.from === from && range.to === to);
    if (!looked && at === value.at) return value;
    return { spec, ranges, more, at, marks: Decoration.set(ranges.map((range, index) => (index === at ? foundAtMark : foundMark).range(range.from, range.to))) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.marks),
});

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
  /** Look for some words in whatever file is shown, and mark every place; null: stop looking. */
  find: (spec: FindSpec | null) => void;
  /** Select a place and bring it into view: the next (1), the one before (-1), or the nearest at or after the caret (0). */
  step: (direction: 1 | -1 | 0) => void;
  /** Select a place by its line (from 1) and where in the line it is, and bring it into view. */
  reveal: (line: number, col: number, len: number) => void;
  /** What is selected, when it is within one line; else nothing. */
  selected: () => string;
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
  let looking: FindSpec | null = null;

  const holdValue = () => [EditorState.readOnly.of(held), EditorView.editorAttributes.of(held ? { class: HELD_CLASS } : {})];
  // `tabindex`: the text is editable and so already a tab stop, but a checker that looks for a way to scroll a long file by keyboard only believes one it can read.
  const nameValue = () => EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true', tabindex: '0' });

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
        found,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) events.onChange(path, update.state.doc.toString());
          const now = update.state.field(found);
          if (now !== update.startState.field(found)) events.onFound?.({ count: now.ranges.length, at: now.at, more: now.more });
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
    // A state made or kept under another hold or name is brought to this one, and searched for what is looked for now.
    view.dispatch({ effects: [hold.reconfigure(holdValue()), name.reconfigure(nameValue()), setFind.of(looking)] });
  };
  const select = (from: number, to: number): void => view.dispatch({ selection: EditorSelection.single(from, to), effects: EditorView.scrollIntoView(from, { y: 'center' }), userEvent: 'select.search' });

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
    find: (spec) => {
      looking = spec;
      view.dispatch({ effects: setFind.of(spec) });
    },
    step: (direction) => {
      const { ranges } = view.state.field(found, false) ?? { ranges: [] };
      if (ranges.length === 0) return;
      const { from, to } = view.state.selection.main;
      const next = direction === -1 ? (ranges.findLast((range) => range.to <= from) ?? ranges.at(-1)) : (ranges.find((range) => range.from >= (direction === 0 ? from : to)) ?? ranges[0]);
      if (next !== undefined) select(next.from, next.to);
    },
    reveal: (line, col, len) => {
      const { doc } = view.state;
      const at = doc.line(Math.min(Math.max(line, 1), doc.lines));
      const from = Math.min(at.from + Math.max(col, 0), at.to);
      select(from, Math.min(from + Math.max(len, 0), at.to));
    },
    selected: () => {
      const { from, to } = view.state.selection.main;
      const text = view.state.sliceDoc(from, to);
      return text.includes('\n') ? '' : text;
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
