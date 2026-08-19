---
'@adminium/widgets': patch
---

Make `global-search`'s header dropdown a real combobox, clearing the last two
CRITICAL `aria-allowed-attr` violations in the axe baseline.

The field was wrapped in a Radix `PopoverTrigger`, which stamps
`type="button"`, `aria-haspopup="dialog"` and `aria-expanded` onto a plain
`<div>`. A screen reader therefore announced the search box as a dialog trigger
sitting on an element that cannot be activated at all — the two fingerprints
axe was reporting, and only the visible symptom of a panel nobody could work:

- **Escape was inert.** `open` was derived from the query alone, so Radix's
  dismiss path had nowhere to write and the panel could not be closed from the
  keyboard. It is now real state; Escape dismisses, an arrow key brings it back
  (the query survives), and a second Escape clears the field, per APG.
- **Typing lost the caret.** Radix moves focus into the panel on open, and the
  panel opens on the *first* keystroke — so focus jumped to the first result
  mid-word. Both auto-focus events are now prevented and focus never leaves the
  field.
- **Tab was a trap.** Radix mounts its FocusScope with `loop: true`, so once
  focus reached a row, Tab cycled through the panel forever. Rows carry
  `tabIndex={-1}` and are reached with the arrow keys instead.
- **The rows were unreachable by keyboard.** ↑/↓ (wrapping), Home/End and ↵ now
  drive an `aria-activedescendant` cursor, with the active row highlighted for
  sighted keyboard users. ↵ replays the row's own click path, so it agrees with
  a mouse click on `onNavigate` and on plain browser navigation.

The panel itself is now the listbox the combobox controls, rather than a dialog
with a list inside it; when a query matches nothing it is a status region
instead, because a listbox may only own options. The full-page variant's
`<ul>/<li>` result markup is unchanged.
