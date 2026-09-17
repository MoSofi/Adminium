---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/widgets': patch
'@adminium/engine': patch
'@adminium/meta': patch
'@adminium/desktop': patch
'@adminium/i18n': patch
'@adminium/config': patch
'@adminium/ui': patch
'@adminium/charts': patch
'@adminium/tokens': patch
---

**Comments stop pointing at documents a reader cannot open.**

- **A new gate**, `pnpm check-private-citations`, in `pnpm preflight` and in CI's `verify` job. It
  reads six forms — a plan document filename, a bare plan number with a section or decision, a
  bare section, a plan or milestone task id, a design comp file, a research annex — and holds
  every file with no baseline entry at zero, so new code cannot add one. A recorded count may
  only shrink, and progress has to be recorded, which is what stops it being given back.
- **13,115 of 16,293 such references are gone**, across 1,679 of the 2,450 files that had one.
  Where the reference was provenance the sentence now stands on its own; where it was doing the
  work of a subject it was reworded. No behaviour changed: a rewrite is refused unless the file's
  compiled output is byte-identical before and after.
- **The reasoning lives in public now**, one short page per decision under
  [/anatomy/decisions/](https://docs.adminium.dev/anatomy/decisions/), which is what a comment
  links to instead of carrying a backstory.
- **A citation of something a reader can open spells the section out** — `AGPL section 13`, not
  the section sign, which is the glyph the gate reads.
- **Two generated files were regenerated from fixed templates** rather than hand-edited:
  `packages/i18n/src/a11y-keys.ts` and the icon core and name list.

**The strings a person actually reads went with them**: the two "not in this build yet" messages
in all 8 locales (and the dashboard's inline fallbacks, which a gate holds character-identical to
the bundle), the 31 widget-suggestion reasons Studio shows, the engine's generation notes, the
three adapters' role hints and not-implemented message, and a handful of validation errors. Six
lint rules now link the decision page instead of citing a document nobody has.

**A third pass took the count from 3,210 to 1,493**, with non-code, markdown and user-visible
strings all at zero: 658 test names (AST-precise, so only a test declaration's own name is
touched), every CHANGELOG — each now carrying a note that its older entries were reworded — the
CI workflows, CSS, HTML, ignore files and `package.json` prose, and the engine's classification
reasons, which Studio shows a person to explain why a column was classified as it was.

**The last 1,443 went by hand, and the surface is now 36 references in 10 files** — every one of
them inside a migration `up`/`down` body, where the bytes are part of a checksum a deployed
instance verifies at boot, so editing one would refuse to start. Those 36 are what the baseline
records. The hand pass also repaired what the earlier sweeps had left mid-sentence: a preposition
or an article against the next punctuation mark, two clauses welded together where the citation
had joined them, 45 comp markers whose document name had been removed from around them, and
three widget-suggestion reasons that lost a real descriptor (`team workload`, `shift scheduler`,
`directory trigger`) along with the citation beside it.
