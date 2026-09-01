---
'@adminium/ui': patch
---

Stop `gen-icon-core.mjs` hoisting the page-builder's private glyph vocabulary
into the dashboard's entry chunk.

The generator collects icon names two ways: declared vocabularies, whose every
entry is checked against lucide's catalogue, and a best-effort sweep of every
`icon:` literal under the scan roots. The sweep's comment claimed over-collecting
cost nothing, because a name lucide does not carry is dropped before anything is
written. That is true of a *wrong* name and false of a right one — a name lucide
really has is emitted, and an emitted name is a static import in the entry chunk
whether or not anything ever resolves it there.

`page-builder`'s `BLOCK_KIND_META` is what proved it. Its `.icon` slugs are read
by exactly one component, `BlockIcon` in `PageBuilder.tsx`, which resolves them
through the local `BLOCK_ICONS` map of static imports and falls back to a dashed
square — never through `CORE_ICONS`, never through `lucideByName`. Attributing
all 144 emitted names to the source that collected them found **eighteen** whose
only origin was that one config file: `AlarmClock`, `Award`, `BadgeCheck`,
`Coins`, `Heading`, `History`, `Minus`, `MousePointerClick`, `MoveVertical`,
`PanelBottom`, `PenLine`, `QrCode`, `Repeat`, `Sigma`, `SquareCheckBig`,
`SquareDashed`, `Text`, `TicketPercent`. The surface that declares them is
`EmailTemplatesPage`, one of the eleven route components deliberately behind
`React.lazy` — so a lazy surface's vocabulary was riding in every cold boot.

`SWEEP_IGNORE` excludes that file, and the `icon:` sweep only: an `<Icon name>`
or `lucideByName()` there would still be collected, because those genuinely do
resolve through this set. 144 icons to 126, and **1,574 bytes gzipped out of the
entry chunk** — 288.4 KiB gz against a 350 KiB target, with the ratchet in
`apps/dashboard/chunk-budget.json` clicked down in the same change.

Less than the ~2.1 KiB a sum-of-parts estimate predicted, for two reasons worth
keeping. `Minus` is imported by name in `Checkbox.tsx`, so dropping it removed an
object-literal key and no module at all; and gzip shares a dictionary across
lucide's very similar path data, so eighteen removals do not cost eighteen icons'
worth. The estimate said which line to pull; the build said what it was worth.

Nothing stops rendering. All eighteen still resolve — `icon-resolver.ts` loads
the full catalogue on demand for a name outside the core set, which is the
designed path for an icon an admin hand-picks by searching — and none of them
appears in either icon picker's curated grid, the engine's shape icons, or any
archetype nav, so no first paint reaches for one.

An ignore entry can go blind the way a declared source can, and the consequence
is worse: it silently stops excluding, and the names return to the entry with
nothing in the log to say why. So an entry naming a file that is gone, or one
with no `icon:` literals left to skip, now fails the generator by name.
