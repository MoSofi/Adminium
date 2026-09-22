---
'@adminium/ui': patch
'@adminium/tokens': patch
---

**New kit pieces: `MethodBadge`, `Sheet`, `CodePane`, and method colour tokens.**

- `MethodBadge` shows GET, POST, PATCH, PUT, DELETE and BATCH in two sizes. PUT and BATCH use
  the new `--method-put` and `--method-batch` colours, which pass the contrast check in every
  theme and accent. `METHOD_TONE` holds the colours for chips and dots.
- `Sheet` is a full-height dialog up to 1180 px wide, with header, bar, body and footer slots.
  It supports opening one sheet over another:
  - the sheet underneath can't be reached while the top one is open;
  - Escape closes only the top one;
  - focus goes back to the button that opened it.
- `CodePane` is a dark code editor pane with a header, a monospace text area, an error strip and
  a footer. It uses the existing always-dark colour scope.
- The new animations are `nb-veil` and `nb-sheet`. Code colours are now available as Tailwind
  classes (`text-code-blue` and so on).
