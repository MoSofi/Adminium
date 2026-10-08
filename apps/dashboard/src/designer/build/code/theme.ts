// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How the editor looks: the fixed-width face at 12.5 px on 20 px lines, the
 * line numbers in a gutter at least 50 wide, the caret's line tinted, and the
 * syntax colours from the tokens (`--syn-*`), which are measured against this
 * ground and that tint.
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

/** The class the editor carries while it may only be read. */
export const HELD_CLASS = 'cm-held';

const look = EditorView.theme({
  '&': { height: '100%', fontSize: '12.5px', color: 'var(--fg)', backgroundColor: 'var(--surface)' },
  // The caret is what says the editor has the keyboard, as in any text field.
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '20px', fontVariantLigatures: 'none', overflow: 'auto' },
  '.cm-content': { padding: '12px 28px 12px 10px', caretColor: 'var(--fg)' },
  '.cm-line': { padding: '0' },
  '.cm-gutters': { minWidth: '50px', backgroundColor: 'transparent', border: 'none', color: 'var(--fg-subtle)', paddingBlock: '0', userSelect: 'none', transition: 'opacity .2s ease' },
  '.cm-lineNumbers': { flex: '1 1 auto' },
  '.cm-lineNumbers .cm-gutterElement': { textAlign: 'end', padding: '0 8px 0 16px', minWidth: '50px', boxSizing: 'border-box' },
  '.cm-gutter': { paddingBlockStart: '0' },
  '.cm-activeLine': { backgroundColor: 'var(--cur-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--fg)' },
  '.cm-cursor, .cm-dropCursor': { borderInlineStartColor: 'var(--fg)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--accent-selection, var(--accent-soft))' },
  // Held: the text keeps its full strength (it must still be read), the furniture steps back.
  [`&.${HELD_CLASS} .cm-gutters`]: { opacity: '0.6' },
  [`&.${HELD_CLASS} .cm-activeLine`]: { backgroundColor: 'color-mix(in srgb, var(--cur-line) 60%, transparent)' },
});

const colours = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword, tags.self, tags.atom, tags.bool, tags.null], color: 'var(--syn-kw)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.character], color: 'var(--syn-str)' },
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--syn-tag)' },
  { tag: [tags.attributeName, tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--syn-attr)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.className, tags.typeName], color: 'var(--syn-fn)' },
  { tag: tags.comment, color: 'var(--syn-com)', fontStyle: 'italic' },
  { tag: [tags.number, tags.unit, tags.color], color: 'var(--syn-num)' },
  { tag: [tags.punctuation, tags.bracket, tags.separator, tags.operator, tags.processingInstruction, tags.meta], color: 'var(--fg-muted)' },
  { tag: tags.heading, color: 'var(--fg)', fontWeight: '700' },
]);

export const editorLook: Extension = [look, syntaxHighlighting(colours)];
