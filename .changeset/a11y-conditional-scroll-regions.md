---
'@adminium/widgets': patch
---

Make the two genuinely-clipping scroll containers keyboard-reachable — baseline
49 → 29, and `scrollable-region-focusable` reaches zero.

Unlike the gantt canvas, whose overflow was a phantom from one unclamped marker,
DiagnosticsReadout and ValidationIssuesList really do clip content: a
keyboard-only operator could read the first four checks of a failing connection
and not the one that failed.

`useScrollRegion` attaches the tab stop CONDITIONALLY — it measures and applies
`tabIndex`/`role` only while the container actually overflows, so a resize that
removes the clipping removes the stop. That matters beyond tidiness: four
scrollers already carrying `role="region" tabIndex={0}` in this repo have zero
overflow in their own stories, so they ship four dead tab stops and four spurious
landmarks today. The blanket fix would have added 38 more.

No `+13` fudge against axe's overflow buffer. An earlier design mirrored it so
"the gate and the product agree"; they do not — axe fired on the gantt at 12px,
so a 13px threshold would leave a flagged node without a stop.

Regions are named by the WidgetFrame heading id (new `WidgetHeadingContext`)
rather than an invented string, so a screen reader announces the words already on
screen — "Connection check", not a second vocabulary — and this adds **zero i18n
keys**. That is deliberate: the previous batch of aria-label keys shipped as
literal English into seven locales while labelled machine-translated.

The list passes no `role`: an explicit one would override the `<ul>`'s implicit
`role="list"` and destroy the "list, N items" announcement.
