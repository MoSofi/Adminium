---
'@adminium/ui': patch
'@adminium/widgets': patch
'@adminium/i18n': patch
---

Fix the accessibility violations the axe sweep had been hiding, and the two
harness defects that hid them.

`a11y-baseline.json` held 162 fingerprints for four weeks. 111 of them do not
reproduce at all.
The sweep runs over the Storybook build, and that build was measuring something
the product does not look like: `storybook.css` `@source`d only `packages/ui`
while `.storybook/main.ts` has loaded the widgets and charts stories since
04-T17, so every widget story rendered unstyled; and nothing painted `--bg` on
the preview body, so under `data-theme="dark"` stories drew dark-theme
foregrounds on Storybook's white body — axe resolves `color-contrast` against
the nearest opaque ancestor, so the translucent tone tints composited over white
and reported pairs the product never renders.

Fixing both exposed violations the unstyled build had concealed. 128 were found
and fixed rather than baselined:

- alpha-dimmed small text on the accent bubble and calendar chips
  (`text-accent-fg/70`, `opacity-80`) measured 3.1–3.9:1 and went to full
  opacity — `--accent-fg` on `--accent` is already gated at 4.5:1, the alpha was
  the whole failure;
- six scrollable regions with no focusable content were mouse-only and now carry
  `tabIndex` with a labelled role (chat transcripts, the AI panel, the queue
  detail pane, three chart matrices, the calendar lists);
- `role="row"` containers whose children carried no cell role made their whole
  table invalid to assistive tech, and now use `rowheader`/`cell`/`columnheader`;
- the grouped-summary expander was `aria-expanded` on a row with a keydown shim,
  and is a real `<button>`;
- a `<dl>` with a direct `<p>` child is corrected;
- `ChipInput` and paused job rows dim to 40–55% and now say `aria-disabled`,
  which is what makes WCAG 1.4.3's inactive-component exemption apply rather
  than merely look as though it should.

The **AuthLayout brand panel** is the one the sweep can never see — it is
`aria-hidden`, so axe skips the subtree while a sighted low-vision user reads all
of it. It painted `--accent`, which resolves to the dark ramp under
`data-theme="dark"`; that ramp is a foreground colour, so it is light, and white
copy on it measured **1.64–2.35:1** across the eight accents. It now paints
`--accent-light` in both themes (5.90–18.88:1), with the white alphas raised and
the testimonial card darkened rather than lightened. A new `brand-panel` group in
the token contrast gate measures it, since nothing else can.

Eight `ui.*` keys were added across all locales for the new region labels.

The baseline now holds 111, measured on the CI platform — the net of 111
artifacts removed, 59 newly exposed and 51 that were real all along. It is
LINUX-CANONICAL from here: a macOS sweep of the same commit reported 1 where CI
reported 111, and since `nested-interactive` and `aria-valid-attr-value` are
pure DOM-structure rules, that gap is not font metrics and is not yet
understood.
