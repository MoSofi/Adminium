---
'@adminium/manifest': patch
'@adminium/server': patch
---

`evaluateFormula` takes what a formula column keeps of its value as a fourth argument, and `formulaKeepOf(column)` reads it from a manifest column: its `normalize` rule, applied first, then for a join the column's length, cut there. An app's demo that passes it shows the value the server stores (a joined address key kept as a code). `normalizedText(how, text)` is the one `normalize` rule: the server keeps typed values, worked-out values, typed codes and addresses through it.
