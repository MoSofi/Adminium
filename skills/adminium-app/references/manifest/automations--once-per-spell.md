<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Automations — Once per spell; do not edit -->

# Manifest spec: Automations — Once per spell

### Once per spell

`forEach.once` is `false` (every time the rule runs), `true` (once ever, for each row) or
`"per-spell"`: once for each time the row **starts** to meet the conditions. A deal that has gone
quiet is told to its owner once; when somebody works on it and it goes quiet again a month later,
its owner is told again. Adminium keeps, for each rule and row, whether the row met the conditions
at the last look. A rule whose `forEach` is changed ends every spell, so a row that still matches is told once more.
