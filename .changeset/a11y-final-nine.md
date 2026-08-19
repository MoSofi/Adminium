---
'@adminium/widgets': patch
'@adminium/tokens': patch
---

Close the last nine axe fingerprints — the baseline is now empty.

**GlobalSearch (2, the only criticals left).** The dropdown rendered a Radix
`PopoverTrigger` onto a `div`, emitting `type="button"` and `aria-haspopup` onto
an element with no button role. It is a `PopoverAnchor` now, and the field is a
real combobox: `role="combobox"`, `aria-expanded`, and `aria-controls` /
`aria-activedescendant` emitted only while the listbox exists. It also gained the
keyboard model it never had — arrows with wrap, Home/End, Enter, and an Escape
that actually closes, which it could not before because `onOpenChange` was absent
and Radix's dismiss path had nowhere to write.

**TopMoversList (2).** Not a missing tab stop — a layout defect. A fixed-width
delta column plus a `shrink-0` sparkline overflowed the row by 6px, clipping the
value. A container query drops the sparkline below 20rem of container width:
measured 274 → 268px, zero overflow. Adding `tabIndex` would have satisfied axe
while leaving the content clipped.

**The other five were never live.** Already fixed by the opaque-chip work, and
still reported only because widget stories bundle `@adminium/ui` from its built
`dist` while ui stories use `src` — the Storybook build predated the dist
rebuild, so one sweep measured two different `Badge` implementations. The rebuild
order is now recorded in the baseline.

Two regressions the combobox work introduced, both invisible to axe because the
story renders with the panel closed: the keyboard cursor was a 10% tint at ~1.1:1
against the panel — the only indication of where Enter would go — and the match
highlight composited over the active row's own tint, dropping below AA. The
cursor now carries an accent rail as well as a solid tint, and the highlight uses
weight and an underline instead of a background.

Also fixes a Rules-of-Hooks violation introduced earlier the same day:
`ValidationIssuesList` called `useScrollRegion` after its empty-state early
return, so a populated list going empty threw "Rendered fewer hooks than
expected".

Adds a gated `selection` group to the token contrast check (240 pairs): `::selection`
set a background and left the foreground to whatever text was dragged across, so
the pair was undefined by construction.
