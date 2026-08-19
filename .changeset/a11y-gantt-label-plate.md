---
'@adminium/widgets': patch
---

Give the gantt bar's progress-% label its own opaque plate, clearing the largest
remaining `color-contrast` group in the sweep (16 fingerprints).

The label was painted `text-fg-muted` — a token sized for the grey TRACK — while
it physically sits on the solid tone FILL, six pixels in from the bar's start
edge. The `task.pct > 55 ? 'text-accent-fg' : 'text-fg-muted'` ternary that was
meant to catch this is a PERCENTAGE proxy for a PIXEL question, and it is wrong
at most bar widths: on any bar more than a few dozen pixels wide the label is
over the fill long before the fill reaches 55%. Composited from the token CSS,
`--fg-muted` on the tone fills measures 1.01:1 (dark `--pos`) to 2.16:1 (light `black` accent; 1.71:1 on light
`--pos`) across the tones and all eight accents, and 1.29:1 on the neutral
`--fg-subtle` fill in both themes — against a 4.5:1 floor for 10px bold text.

No better threshold exists to reach for. The fill is a percentage of a
flex-sized bar, so the component cannot know where the label lands without
measuring at runtime. Two alternatives were tried and rejected: a `clip-path`
two-copy scheme (the var lives on the fill, not the bar, so it computed to
`none`; axe ignores `clip-path` and `color-contrast` runs `excludeHidden: false`,
so the hidden copy counted too — 3 violating nodes became 4), and an
`aria-disabled`/opacity dodge, which silences the rule without moving a pixel.

So the label stops depending on what is behind it. An inner
`rounded-sm bg-surface px-1` span puts one known opaque token under the text
regardless of tone, accent, fill percentage or bar width: `--fg-muted` on
`--surface` measures **8.75:1 in light and 9.25:1 in dark**, identical in every
accent. Over an unfilled stretch the plate is 1.13:1 against the `--surface-3`
track, i.e. all but invisible — so bars that read fine before still look the
same, and only the label sitting on colour gains a visible chip.

For a sighted low-vision user this is the difference between a number that is
there and a number that is not: at 1.0-1.7:1 the densest datum in the widget was
effectively unreadable at any zoom or contrast setting, and it now reads at the
same strength as the task name in the gutter beside it. Assistive-technology behaviour is **unchanged** either way — the bar has
always carried `role="img"` with an aria-label of `"label · pct"`, so the visual
label is decorative and was never the accessible name. No 1.4.11 non-text floor
attaches to plate-against-fill for the same reason.

The bar's `overflow-hidden` and the milestone/today-line clamps
(`min(…, calc(100% - 14px))`, `calc(100% - 2px)`) are untouched — those close a
different defect (a phantom horizontal scroll) and must not regress.
