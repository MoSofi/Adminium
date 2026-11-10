<!-- produced from apps/docs/src/content/docs/guides/apps/working-days.md § Limits; do not edit -->

# Ready-by dates in working days: Limits

- At most 400 working days; more is refused `out-of-range` on the days' column.
- Closures are read over 800 calendar days from `from`. A count that would run past them is refused
  `out-of-range`, never guessed.
- Negative days are refused.
- The rule has no editor in the Studio yet: write it in the manifest.
