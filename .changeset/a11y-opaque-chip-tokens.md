---
'@adminium/tokens': patch
'@adminium/ui': patch
---

Give tinted chips a contrast of their own — pre-composited `--*-soft-solid` tints.

A soft-tone chip was translucent, so it had no contrast ratio of its own: it
inherited whatever it happened to be re-parented onto. The same "Canceled" tag
measured one number on a plain table row and another on a selected one, and a
nav count badge dropped to 4.36:1 the moment its row went active — against AA's
4.5:1. The measured failures were 4.36:1 (nav badge) and 4.41:1 (datagrid tag),
but the class is larger than those two: any tint over a tint, anywhere, and no
component can see it locally.

The token gate could not see it either, and not by oversight. It enumerates the
four surfaces a tint composites over; it cannot enumerate "this chip will be
nested inside another component's tint", because the token layer does not know
what a component lands in.

So the backdrop moves out of the DOM and into the value. Five new tokens —
`--accent-soft-solid`, `--pos-soft-solid`, `--warn-soft-solid`,
`--danger-soft-solid`, `--info-soft-solid` — are the same tints pre-composited
over `--surface` (accent 10% light / 12% dark, semantics 14% dark; light's
semantic softs are already opaque hexes and alias them). `toneSoftClasses` now
paints those, so Badge, StatusPill, IconTile and RuntimeChip get a chip whose
contrast is a property of the token.

**Appearance change, deliberate and owner-approved:** a chip sitting on a
`--surface-2` or `--surface-3` card now paints a `--surface`-based pill, so it
reads a shade lighter than the card under it. A chip already on `--surface` is
byte-identical to before. That is the trade for a number that cannot vary with
nesting.

Every existing `-soft` token is untouched and still translucent — row
highlights, active nav rows, panel washes and Alert/Banner backgrounds have to
layer, and layering is exactly what a chip must not do.

The gate gains a `chip-solid` group (gated, 288 rows; 3,328 → 3,616 pairs, all
passing, worst 4.56:1). Each tone is pushed against its solid on all four
surfaces even though an opaque tint cannot vary with them — the four rows are
supposed to be identical, and printing them is what shows the invariance. Two
new vocabulary guards keep the name honest: a `-soft-solid` that is translucent
is refused outright (it would produce a full set of passing rows while the name
went on promising a fixed backdrop), and a wash with no solid twin is refused
too (the chip utility would resolve to an undefined var and paint nothing while
the gate simply emitted four fewer passes). Both exception scopes re-declare the
new tokens; omitting them measures 1.77:1, since a solid left to the root
arrives pre-mixed with the root's surface.

Not done with `background-image: linear-gradient(...)`, which reaches the same
pixel: it converts a measured violation into `incomplete: bgGradient` and would
remove Badge/Tag/StatusPill/IconTile from axe's reach permanently.

The four chip tests that were supposed to break did not, which is its own
finding: `className.toContain('bg-accent-soft')` is a substring match and passes
for `bg-accent-soft-solid`, so those assertions rode straight through the swap.
They now match whole class names against the shared recipe, and one test pins
the recipe itself to the opaque token family so a silent revert fails.
