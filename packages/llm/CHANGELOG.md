# @adminium/llm

## 0.2.3

### Patch Changes

- Updated dependencies [7e5f704]
- Updated dependencies [8ed7972]
- Updated dependencies [ac3f5e7]
- Updated dependencies [9e1adf7]
  - @adminium/widgets@0.2.3
  - @adminium/engine@0.2.3

## 0.2.2

### Patch Changes

- 2dffc12: Stop a dead icon name costing a generated app its first paint, and put 64
  untranslated keys into the locale bundles.
  
  - `kanban-square` is not a lucide icon — it was renamed to `square-kanban`. It
    was emitted as `nav.icon` by the page generator, so any generated app with a
    workflow-shaped table fetched the entire ~137 KB icon catalogue on first paint
    to discover the name was dead, then drew the neutral `File` fallback anyway.
    A second instance, `bar-chart-3`, was found by the new gate.
  - `gen-icon-core.mjs` already computed the list of declared-but-unknown icon
    names and discarded it, printing only a count. It now fails in both `--check`
    and write mode, naming the offending file and the canonical rename.
  - `LUCIDE_ICON_NAMES` is now a real export. `allowedIcons` was documented as
    fed by it, that symbol existed nowhere, and nothing supplied the value — so
    the unknown-icon warning and the `table` fallback never fired and a model
    could store any hallucinated icon string on a table.
  - 64 `t()` keys existed in no locale bundle and rendered a hardcoded English
    default in all 8 locales, 56 of them the Settings → Languages & translations
    page itself — the one page whose keys the in-product translation editor
    cannot reach, because it refuses any key absent from the compiled bundle.
    All 8 bundles now carry them, translated rather than copied from English.
- Updated dependencies [0664dd4]
- Updated dependencies [2516a82]
- Updated dependencies [8477a70]
- Updated dependencies [cca257b]
- Updated dependencies [cca257b]
- Updated dependencies [8477a70]
- Updated dependencies [b204486]
- Updated dependencies [1002d67]
- Updated dependencies [8477a70]
- Updated dependencies [08df45d]
- Updated dependencies [66f0683]
- Updated dependencies [2dffc12]
- Updated dependencies [08df45d]
- Updated dependencies [2684976]
- Updated dependencies [ef1c300]
  - @adminium/widgets@0.2.2
  - @adminium/engine@0.2.2

## 0.2.2-rc.0

### Patch Changes

- Updated dependencies [2684976]
- Updated dependencies [ef1c300]
  - @adminium/engine@0.2.2-rc.0
  - @adminium/widgets@0.2.2-rc.0

## 0.2.1

### Patch Changes

- @adminium/widgets@0.2.1
- @adminium/engine@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [1d7c7b4]
- Updated dependencies [1d7c7b4]
  - @adminium/engine@0.2.0
  - @adminium/widgets@0.2.0

## 0.1.0

### Minor Changes

- First public release: the Adminium CLI/server and its library packages.

### Patch Changes

- Updated dependencies
  - @adminium/engine@0.1.0
  - @adminium/widgets@0.1.0
