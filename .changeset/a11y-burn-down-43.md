---
'@adminium/widgets': patch
'@adminium/ui': patch
---

Burn 43 accessibility violations down to zero, and ratchet the baseline from 112
to 69.

The distinction from the previous move matters: 162 -> 112 was ~85%
re-measurement, where fingerprints left because the harness changed. All 43 here
left because component code changed, each verified gone by re-running the sweep
against a freshly built Storybook rather than by editing the baseline.

**20 `nested-interactive` — DocumentCanvas.** Every block was wrapped in
`role="button" tabIndex={0}` to get click-to-select. That role is
children-presentational, so the line-item table, its four column headers and its
qty/rate inputs were stripped from the accessibility tree and the entire block
announced as the single string "block-line-items, button, not pressed". The
wrapper is now inert and selection rides a real `<button>` named from the block's
own visible, localized heading — so the table is a table again, the headers
associate with the inputs, and Enter/Space work natively instead of through a
handler that had to guard against stealing Space from a number input.

**12 `aria-valid-attr-value` — TabBar.** The strip renders no `TabsContent` by
design, but Radix's Trigger emits `aria-controls` pointing at a panel id
unconditionally, so every selected tab advertised a relationship to an element
never in the DOM. axe skips a dangling IDREF on `aria-selected="false"`, which is
why this was 12 fingerprints rather than 60.

**11 `color-contrast`.** Three wrapper `opacity` utilities dragged informational
text sitting beside operable controls to 2.21–3.29:1 — including the product's
primary `--fg` token failing AA purely from a container — on exactly the text
someone reads to decide whether to re-enable a dormant webhook or policy. WCAG's
inactive-component exemption does not apply to content beside a live Switch. The
loyalty banner also moved off the accent tint, where its headline number was the
least readable text in the block at 4.42:1.

Two `qa-widget-states` entries were deliberately NOT pruned: they did not
reproduce before this change either, so there is no evidence they are fixed
rather than sitting below axe's 13px overflow buffer on this machine.
