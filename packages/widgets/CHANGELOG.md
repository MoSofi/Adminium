# @adminium/widgets

## 0.2.2

### Patch Changes

- 0664dd4: Burn 43 accessibility violations down to zero, and ratchet the baseline from 112
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
- 2516a82: Make the two genuinely-clipping scroll containers keyboard-reachable — baseline
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
- cca257b: Give the gantt bar's progress-% label its own opaque plate, clearing the largest
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
- cca257b: Clear the gantt canvas's 16 `scrollable-region-focusable` violations by removing
  the overflow rather than by making the region focusable — baseline 69 → 53.
  
  The obvious reading is that the timeline is too wide for its card and a keyboard
  user cannot scroll to the rest of the project. Measured, that is false: at the
  sweep's own viewport the canvas is 746px against a 734px client width. The 12px
  comes from ONE absolutely-positioned milestone diamond placed at ~100% with no
  clamp, so its rotated bounding box hangs past the right edge.
  
  That distinction decides the fix. Adding `tabIndex` would have put a keyboard
  stop — and, in the version first proposed, a landmark — on a region containing
  nothing to reach, which satisfies axe while making the product slightly worse to
  navigate. The same proposal would have added 38 such stops across four families.
  Clamping the marker to `calc(100% - 14px)` removes the phantom scroll, so there
  is no scrollable region left to be unreachable.
  
  The today-line marker is clamped the same way (`calc(100% - 2px)`): a project
  whose current date lands on the last day would otherwise reintroduce the
  identical defect from a different direction.
- 8477a70: Make `global-search`'s header dropdown a real combobox, clearing the last two
  CRITICAL `aria-allowed-attr` violations in the axe baseline.
  
  The field was wrapped in a Radix `PopoverTrigger`, which stamps
  `type="button"`, `aria-haspopup="dialog"` and `aria-expanded` onto a plain
  `<div>`. A screen reader therefore announced the search box as a dialog trigger
  sitting on an element that cannot be activated at all — the two fingerprints
  axe was reporting, and only the visible symptom of a panel nobody could work:
  
  - **Escape was inert.** `open` was derived from the query alone, so Radix's
    dismiss path had nowhere to write and the panel could not be closed from the
    keyboard. It is now real state; Escape dismisses, an arrow key brings it back
    (the query survives), and a second Escape clears the field, per APG.
  - **Typing lost the caret.** Radix moves focus into the panel on open, and the
    panel opens on the *first* keystroke — so focus jumped to the first result
    mid-word. Both auto-focus events are now prevented and focus never leaves the
    field.
  - **Tab was a trap.** Radix mounts its FocusScope with `loop: true`, so once
    focus reached a row, Tab cycled through the panel forever. Rows carry
    `tabIndex={-1}` and are reached with the arrow keys instead.
  - **The rows were unreachable by keyboard.** ↑/↓ (wrapping), Home/End and ↵ now
    drive an `aria-activedescendant` cursor, with the active row highlighted for
    sighted keyboard users. ↵ replays the row's own click path, so it agrees with
    a mouse click on `onNavigate` and on plain browser navigation.
  
  The panel itself is now the listbox the combobox controls, rather than a dialog
  with a list inside it; when a query matches nothing it is a status region
  instead, because a listbox may only own options. The full-page variant's
  `<ul>/<li>` result markup is unchanged.
- b204486: Stop MasterList flattening its own rows out of the accessibility tree — baseline
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
- 1002d67: Give ScheduleMatrix's `role="table"` the header and cell roles the role requires
  — baseline 53 → 49.
  
  A table's rows must contain header/cell roles. Column 1 of the header row was a
  bare `<span>`, the resource cell had no `rowheader`, and the coverage cells had
  no `cell`, so a screen reader announced the first column as nothing and the
  coverage row as unstructured text.
  
  The fix is a verbatim port from the twin file `ShiftMatrix`, which already had
  the correct treatment — and the twin got the two pieces IT was missing
  (`columnheader` on its own leading span, `aria-hidden` on its Avatar), so the
  fork stops drifting further apart.
  
  The Avatar needed hiding either way: its `aria-label` repeats the name rendered
  beside it, so the rowheader's accessible name was doubling to
  "Ana Trujillo Ana Trujillo, Manager · 32h".
  
  `calendar-widgets.test.tsx`'s weekStart case took the first `[role="columnheader"]`
  as the first DAY column. "Resource" is legitimately a columnheader now, so the
  selector moves to index 1 with an assertion pinning why.
- 8477a70: Fix the top-movers row so it fits its column — the last two
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
- 08df45d: Fix the accessibility violations the axe sweep had been hiding, and the two
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
  
  The baseline now holds 112, and getting a trustworthy number took two wrong
  answers first. `data-vrt-ready` was a bare mount effect while widget bodies load
  as per-family lazy chunks, so the sweep raced the stories: a fast machine
  reported 1 violation and CI reported 111 on the same commit. The sweep and the
  VRT spec now navigate with `networkidle` and the flag waits for DOM quiescence,
  after which both agree. Against the original 162: 111 do not reproduce, 51 were
  real all along, and 59 more were exposed once the stories rendered styled.
- 66f0683: Stop bulk export silently dropping every row selected on an earlier page.
  
  `page-crud`'s selection survives paging, and the browser-side export — which is
  the path every user takes, because no host implements the optional
  `CrudApi.export` — filtered the CURRENTLY LOADED page by the selected ids.
  Select on page one, page forward, select again, export: page one's rows were
  gone from the file, with nothing on screen to say so. The toolbar still counted
  them.
  
  The template now snapshots each selected row as it is selected — from the rows
  the grid was rendering when the click happened, so a row that could be clicked
  can never be missed — and exports from that, in selection order. Membership is
  captured in the selection handler rather than in an effect keyed on the loaded
  page: an effect can only record rows that happen to be loaded when it runs,
  which would have made the snapshot depend on effect ordering against the list,
  the same class of bug as the one it exists to fix. Deselecting drops a row from the snapshot; deleting a
  row drops it from the SELECTION too, on the single-row path as well as the bulk
  one — a deleted row must not keep being counted, and must not turn up in a file.
  
  One new string, `templates.crud.toast.exportIncomplete`, covers the case the
  design makes unreachable: if the snapshot were ever short, the export says how
  many rows it wrote. The point of the fix is that a short export can no longer be
  a silent one.
  
  The queued server-side run is deliberately still not wired: `ExportSource` on the
  wire carries `{kind, table, viewId, filters}` and no row selection at all, so
  implementing `export` against it as it stands would widen a selection export to
  the whole table — trading a silent drop for a silent over-export.
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
- Updated dependencies [0664dd4]
- Updated dependencies [8477a70]
- Updated dependencies [8477a70]
- Updated dependencies [f987544]
- Updated dependencies [08df45d]
- Updated dependencies [f7c9566]
- Updated dependencies [66f0683]
- Updated dependencies [f987544]
- Updated dependencies [586426a]
- Updated dependencies [08df45d]
- Updated dependencies [e15787b]
- Updated dependencies [d3a04c8]
- Updated dependencies [2dffc12]
- Updated dependencies [1d952df]
- Updated dependencies [2728dea]
- Updated dependencies [4f297da]
- Updated dependencies [00cd08f]
- Updated dependencies [ef1c300]
  - @adminium/ui@0.2.2
  - @adminium/tokens@0.2.2
  - @adminium/i18n@0.2.2
  - @adminium/charts@0.2.2

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
- Updated dependencies [00cd08f]
- Updated dependencies [ef1c300]
  - @adminium/i18n@0.2.2-rc.0
  - @adminium/ui@0.2.2-rc.0
  - @adminium/charts@0.2.2-rc.0
  - @adminium/tokens@0.2.2-rc.0

## 0.2.1

### Patch Changes

- Updated dependencies [4091a4f]
  - @adminium/i18n@0.2.1
  - @adminium/charts@0.2.1
  - @adminium/tokens@0.2.1
  - @adminium/ui@0.2.1

## 0.2.0

### Patch Changes

- 1d7c7b4: Runtime translation overrides, add-on contracts, and Studio navigation.

  `@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

  `@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.

- Updated dependencies [1d7c7b4]
- Updated dependencies [1d7c7b4]
  - @adminium/i18n@0.2.0
  - @adminium/ui@0.2.0
  - @adminium/tokens@0.2.0
  - @adminium/charts@0.2.0

## 0.1.0

### Minor Changes

- First public release: the Adminium CLI/server and its library packages.

### Patch Changes

- Updated dependencies
  - @adminium/charts@0.1.0
  - @adminium/i18n@0.1.0
  - @adminium/tokens@0.1.0
  - @adminium/ui@0.1.0
