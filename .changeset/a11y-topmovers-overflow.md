---
'@adminium/widgets': patch
---

Fix the top-movers row so it fits its column — the last two
`scrollable-region-focusable` entries, and a content bug the rule was pointing at
all along.

These two fingerprints survived five passes because they never reproduced on a
macOS developer machine: the list overflowed by 6px and axe's matcher carries a
13px buffer. Measured in headless Chromium at the sweep's own 1280px viewport,
against the QA gallery's 4-up row, the overflow is real and it is not the
interesting part.

Four of the five columns are `shrink-0` — icon tile, sparkline, value, delta pill
— so flexbox spends the only flexible one, the NAME, first. In a 252px column
that is not a near miss. Three of the five metric names rendered 18px wide and
**two rendered at zero width**, so a row reading "Refunds · $3,202.00 · −18.9%"
showed as an anonymous icon, a sparkline and two numbers with nothing saying
which metric had moved. The row still overflowed its line box by 14px on top of
that.

So this is a layout defect, not a missing tab stop. `tabIndex={0}` on the
container would have satisfied the rule and left every name clipped — the same
defect as baselining, with extra steps.

The fixed columns need 204px (12 padding + 4×12 gap + 28 tile + 48 spark + 68
pill) before a single character of name or value, and a currency value with cents
measures ~68px, so a legible name only exists from about 320px up. Below `20rem`
the **sparkline** is dropped, returning 60px with its gap. It is the right column
to lose: direction and size of the move are already carried twice, by the
tone-tinted trend glyph and by the delta pill, while the name is the only thing
in the row that identifies the metric.

Measured before → after at the sweep viewport, 252px of list content:

| | overflow | narrowest name |
|---|---|---|
| before | 6px on the list, 14px on the widest row | **0px** (2 of 5 rows) |
| after | 0px | 40.5px, all 5 rows legible |

A **container** query, not a media query: this widget's width comes from the
dashboard cell it lands in, not the viewport. At one 1280px viewport it renders
at 1230px full-bleed and 252px in a 4-up row — measured, the sparkline is
untouched in the former and only drops in the latter.

The truncated name also gains a `title`, so a mouse user can read a metric the
column is too narrow to spell out. Screen readers always had the full text.

Separately, the read-only list takes a CONDITIONAL scroll region
(`useScrollRegion`) for the clipping layout cannot fix: a list taller than its
frame, whose rows below the fold are unreachable without a mouse. It attaches
nothing when nothing is clipped, and nothing at all to the drill-through variant,
whose rows are already `<button>`s. No `role` is passed — an explicit one would
replace the `<ul>`'s implicit `role="list"` and the "list, N items" count with
it.
