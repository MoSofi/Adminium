# @adminium/tokens

## 0.2.4

## 0.2.3

## 0.2.2

### Patch Changes

- 8477a70: Pin both halves of the ::selection pair, and gate it
  
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
- 8477a70: Close the last nine axe fingerprints — the baseline is now empty.
  
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
- f987544: Give tinted chips a contrast of their own — pre-composited `--*-soft-solid` tints.
  
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
- ef1c300: Let admins create and edit pages from Studio, and give every screen one gutter.
  
  Pages are now a first-class thing an admin can make. Studio gains a pages
  section — create, duplicate, reorder columns, pick an icon, choose a template —
  backed by page lifecycle routes on the server and the page repo and permission
  checks in `@adminium/meta`. Until now a page existed only as something the
  generator emitted from a schema snapshot, so a hand-made page had no way to
  fill its own body.
  
  `@adminium/engine` gains the entry point that makes that possible.
  `generatePages` composes a whole app and picks every template itself;
  `composeRequestedArchetype` composes one page but only for the nine archetypes,
  because it delegates to `buildArchetypeEnvelope` and that returns null for
  anything else. Neither serves an admin who picked `page-crud` for a table by
  hand, which is the most common choice. `recompose` is the missing third door:
  the same classify → candidates → compose prelude, dispatching to
  `buildCrudEnvelope` or `buildArchetypeEnvelope` as the template demands, so the
  server can rebuild a page's body from live schema instead of leaving it empty.
  Templates that are not table-bound — `page-dashboard` composes from a domain,
  and `page-builder`/`page-wizard`/`page-settings` are tool surfaces whose bodies
  the renderers ignore — return `bindable: false` with a null envelope, so the
  caller keeps whatever the page already had rather than blanking it.
  
  The second half is `PageSurface`. Every routed screen used to invent its own
  gutter — `p-6` here, `p-[var(--main-pad)]` there, `p-10` on one wizard, nothing
  at all on the templates that forward straight to `@adminium/widgets` — so the
  padding changed every time you moved between two screens of the same app. Now
  each screen renders exactly one `PageSurface`, which owns the inner main
  section and is the only thing that can set the gutter; the shell's sidebar and
  topbar sit outside it and are unaffected. It takes `standard` (the density-scaled
  `--main-pad`), `none` for templates that draw their own full-bleed chrome, or an
  explicit x/y pair from a page's stored config, with `width: 'content'` as an
  independent knob for screens that are a short stack of controls rather than a
  grid.
  
  Chart and KPI text now has a legibility floor held by a test rather than by
  eye, and the theme control moved out of the header into the account menu as a
  verb-labelled item ("Light mode" / "Dark mode") that keeps its ⌘⇧L shortcut.

## 0.2.2-rc.0

### Patch Changes

- ef1c300: Let admins create and edit pages from Studio, and give every screen one gutter.
  
  Pages are now a first-class thing an admin can make. Studio gains a pages
  section — create, duplicate, reorder columns, pick an icon, choose a template —
  backed by page lifecycle routes on the server and the page repo and permission
  checks in `@adminium/meta`. Until now a page existed only as something the
  generator emitted from a schema snapshot, so a hand-made page had no way to
  fill its own body.
  
  `@adminium/engine` gains the entry point that makes that possible.
  `generatePages` composes a whole app and picks every template itself;
  `composeRequestedArchetype` composes one page but only for the nine archetypes,
  because it delegates to `buildArchetypeEnvelope` and that returns null for
  anything else. Neither serves an admin who picked `page-crud` for a table by
  hand, which is the most common choice. `recompose` is the missing third door:
  the same classify → candidates → compose prelude, dispatching to
  `buildCrudEnvelope` or `buildArchetypeEnvelope` as the template demands, so the
  server can rebuild a page's body from live schema instead of leaving it empty.
  Templates that are not table-bound — `page-dashboard` composes from a domain,
  and `page-builder`/`page-wizard`/`page-settings` are tool surfaces whose bodies
  the renderers ignore — return `bindable: false` with a null envelope, so the
  caller keeps whatever the page already had rather than blanking it.
  
  The second half is `PageSurface`. Every routed screen used to invent its own
  gutter — `p-6` here, `p-[var(--main-pad)]` there, `p-10` on one wizard, nothing
  at all on the templates that forward straight to `@adminium/widgets` — so the
  padding changed every time you moved between two screens of the same app. Now
  each screen renders exactly one `PageSurface`, which owns the inner main
  section and is the only thing that can set the gutter; the shell's sidebar and
  topbar sit outside it and are unaffected. It takes `standard` (the density-scaled
  `--main-pad`), `none` for templates that draw their own full-bleed chrome, or an
  explicit x/y pair from a page's stored config, with `width: 'content'` as an
  independent knob for screens that are a short stack of controls rather than a
  grid.
  
  Chart and KPI text now has a legibility floor held by a test rather than by
  eye, and the theme control moved out of the header into the account menu as a
  verb-labelled item ("Light mode" / "Dark mode") that keeps its ⌘⇧L shortcut.

## 0.2.1

## 0.2.0

### Patch Changes

- 1d7c7b4: Runtime translation overrides, add-on contracts, and Studio navigation.

  `@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

  `@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.

## 0.1.0

### Minor Changes

- First public release: the Adminium CLI/server and its library packages.
