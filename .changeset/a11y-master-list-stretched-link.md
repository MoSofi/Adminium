---
'@adminium/widgets': patch
---

Stop MasterList flattening its own rows out of the accessibility tree — baseline
29 → 25, and `nested-interactive` reaches zero.

The row carried `role="button"` with a tabIndex and a key handler to make the
whole row clickable. That role is children-presentational, so every control
inside it was erased for AT users: a screen-reader user heard one flattened
string and lost the StatusPill, the ProgressBar's value, and the Switch's role
and on/off state entirely — the exact failure `nested-interactive` names.

The row is now inert. Selection rides the visible row TITLE as a real `<button>`
whose `::after` stretches the hit area back over the whole row, so the mouse
target is unchanged and `has-[:focus-visible]` still paints the ring around the
row. Because the accessible name is the title the user can already see, there is
no sr-only duplicate string and no new i18n key — which also means no edits
across 8 locales and no regeneration of the a11y-keys drift guard.

The Switch gets `relative z-10` to sit above that hit area, and loses a
`stopPropagation` that no longer has an interactive ancestor to stop.

`track-f-widgets.test.tsx` passes UNCHANGED. That is the tell: `getByText('Beta
rule')` now resolves inside the button, so the click lands on a real control
rather than propagating from a sibling — which an overlay-based fix would have
broken.
