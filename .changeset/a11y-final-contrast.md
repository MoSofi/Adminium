---
'@adminium/tokens': patch
---

Pin both halves of the ::selection pair, and gate it

`::selection` set a background and left the foreground to whatever text the user
happened to drag across, so the pair was undefined by construction. Over a plain
surface that was fine — which is why lowering `--accent-selection` from 22% to
12% looked like a fix — but the tint is translucent, so its real backdrop is
whatever is underneath: measured on the shipped palette, `--fg-subtle` on a
selected table row fell to 3.474:1, `--accent` on an active sidebar row to
3.892:1, and `--fg` dragged across a primary button's own fill to 1.080:1
(monochrome accent; 2.78:1 on indigo).

`--accent-selection` is now pre-composited over `--surface` — the same move the
`-soft-solid` chip tints made, for the same reason — and `::selection` sets
`color: var(--fg)`. The pair is a property of the palette instead of the page:
`--fg` on it measures >=13.038:1 across both themes, all eight accents and both
exception scopes, on every surface and on `--accent` itself. Over a plain
`--surface` the colour is byte-identical to before; only the layered cases move.
The cost, taken deliberately: selected text loses its own colour while selected,
as it does in every browser's default selection.

The gate gains a `selection` group (240 pairs, gated, min 13.038:1) that measures
`--fg` on the tint over every surface AND over `--accent` — a solid fill is not a
page background, but its label is draggable text, and no other group covers it.
axe cannot see any of this: it does not evaluate `::selection`, so this failure
had no automated witness.
