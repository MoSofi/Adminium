---
'@adminium/engine': patch
'@adminium/llm': patch
'@adminium/ui': patch
'@adminium/i18n': patch
---

Stop a dead icon name costing a generated app its first paint, and put 64
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
