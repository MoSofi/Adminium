---
'@adminium/widgets': patch
'@adminium/engine': patch
---

**A page's own file column reached the create dialog again, and a CHECK-expression regex stopped backtracking.**

- **The derived form read the schema's spec and not the page's.** Binding a page's
  attachments to a column makes it a file column *for that page* — a fact the page
  config carries and the schema does not. The form document is derived from the
  server's column facts, and the derivation stamps a control per column, so the
  control was chosen before the stored spec was ever consulted and an attachments
  column drew as a plain text box. `PageCrud` now merges the stored spec over the
  fact before deriving, the same precedence `editableColumns` already applied.
- **A text control names its type.** `TextControl` rendered an `<input>` with no
  `type` attribute. It behaves as a text box either way, but `input[type="text"]`
  matches an attribute, so anything selecting the form's text fields found none.
- **`parseEnumCheck` reads quoted literals with a scanner, not a regex.**
  `/"((?:[^"\\]|\\.)*)"/g` backtracks polynomially on an expression full of
  escaped quotes — and so does the unrolled form, because `matchAll` RESTARTS at
  every position and each restart rescans to the end when no closing quote
  follows. A CHECK expression comes back from whatever the database stored, and
  this runs on every table a diff opens. The scanner only ever moves forward.
