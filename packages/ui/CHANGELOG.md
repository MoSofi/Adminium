# @adminium/ui

## 0.2.4

### Patch Changes

- @adminium/tokens@0.2.4

## 0.2.3

### Patch Changes

- 9e1adf7: Regenerate `icon-core.ts` for the page-builder's six email blocks.
  
  The generated static-import set had gone stale against
  `packages/widgets/src/templates/page-builder/builder-config.ts`, which added
  `email.heading`, `email.text`, `email.button`, `email.divider`, `email.spacer`
  and `email.footer` with icon slugs the file did not carry — so
  `gen-icon-core.mjs --check`, and the `packages/ui` test that asserts the same
  thing from the other side, both failed.
  
  138 icons to 144, and 444 bytes gzipped onto the dashboard's entry chunk. Five
  are genuinely new weight, not six: `Minus` was already there, imported by name
  in `Checkbox.tsx` and three other entry-reachable components, so listing it cost
  nine bytes of object key.
  
  Worth saying plainly, because the number is the wrong shape for what it buys:
  those six icons are entry weight nothing renders. The page-builder resolves a
  block glyph through `BLOCK_ICONS` in its own `PageBuilder.tsx` — a local map of
  static imports, with a `SquareDashed` fallback — and never through lucide's
  catalogue or `lucideByName`. The generator's best-effort `icon:` sweep collects
  them anyway, which its own docblock predicts ("the page-builder resolves its
  `icon:` slugs through a LOCAL map").
  
  They are not the first. Re-attributing all 144 emitted names to the source that
  collected them shows **eighteen whose only origin is that one config file** —
  today's six plus twelve already shipping. The surface that declares them is
  `EmailTemplatesPage`, which RELEASE-GATE.md records as one of the eleven route
  components deliberately moved behind `React.lazy`. Its vocabulary was in
  everybody's cold boot regardless.
  
  It could not be skipped, either: `icon-core.test.ts` shells out to
  `gen-icon-core.mjs --check`, so that test was red until this ran, and hand-editing
  the file back would only be reverted by the next `--check`.
  
  So this step restored the gate rather than fixing anything visible, and it named
  two follow-ups. **Both land in this same release, so the numbers above are not
  the release's net** — read the two entries beside this one for the outcome.
  
  `BLOCK_ICONS` had none of the six email slugs, so each fell through its
  `?? SquareDashed` default: seven of the seventeen rows in the email palette drew
  the same dashed square (the six new ones, plus `block-highlight-box`, which maps
  to that glyph legitimately), and the six were the message rail at the top of the
  list. Cosmetic — every row still carried its own text label and the glyph is
  `aria-hidden` — and invisible to CI: the only test that inspected these asserted
  the slug is kebab-case, the Storybook story that renders the palette carries no
  `vrt` tag, and axe cannot see an aria-hidden icon. Fixed in `@adminium/widgets`,
  which also adds a test that renders every palette row on every doc type.
  
  Excluding `builder-config.ts` from the generic sweep was the other half, and it
  is done: 144 icons back down to 126, and 1,574 bytes gzipped *out* of the entry
  chunk rather than 444 in. The estimate above said ~2.1 KiB; the build says 1,574,
  because `Minus` was already entry-resident and gzip shares a dictionary across
  lucide's near-identical path data.
- 9e1adf7: Stop `gen-icon-core.mjs` hoisting the page-builder's private glyph vocabulary
  into the dashboard's entry chunk.
  
  The generator collects icon names two ways: declared vocabularies, whose every
  entry is checked against lucide's catalogue, and a best-effort sweep of every
  `icon:` literal under the scan roots. The sweep's comment claimed over-collecting
  cost nothing, because a name lucide does not carry is dropped before anything is
  written. That is true of a *wrong* name and false of a right one — a name lucide
  really has is emitted, and an emitted name is a static import in the entry chunk
  whether or not anything ever resolves it there.
  
  `page-builder`'s `BLOCK_KIND_META` is what proved it. Its `.icon` slugs are read
  by exactly one component, `BlockIcon` in `PageBuilder.tsx`, which resolves them
  through the local `BLOCK_ICONS` map of static imports and falls back to a dashed
  square — never through `CORE_ICONS`, never through `lucideByName`. Attributing
  all 144 emitted names to the source that collected them found **eighteen** whose
  only origin was that one config file: `AlarmClock`, `Award`, `BadgeCheck`,
  `Coins`, `Heading`, `History`, `Minus`, `MousePointerClick`, `MoveVertical`,
  `PanelBottom`, `PenLine`, `QrCode`, `Repeat`, `Sigma`, `SquareCheckBig`,
  `SquareDashed`, `Text`, `TicketPercent`. The surface that declares them is
  `EmailTemplatesPage`, one of the eleven route components deliberately behind
  `React.lazy` — so a lazy surface's vocabulary was riding in every cold boot.
  
  `SWEEP_IGNORE` excludes that file, and the `icon:` sweep only: an `<Icon name>`
  or `lucideByName()` there would still be collected, because those genuinely do
  resolve through this set. 144 icons to 126, and **1,574 bytes gzipped out of the
  entry chunk** — 288.4 KiB gz against a 350 KiB target, with the ratchet in
  `apps/dashboard/chunk-budget.json` clicked down in the same change.
  
  Less than the ~2.1 KiB a sum-of-parts estimate predicted, for two reasons worth
  keeping. `Minus` is imported by name in `Checkbox.tsx`, so dropping it removed an
  object-literal key and no module at all; and gzip shares a dictionary across
  lucide's very similar path data, so eighteen removals do not cost eighteen icons'
  worth. The estimate said which line to pull; the build said what it was worth.
  
  Nothing stops rendering. All eighteen still resolve — `icon-resolver.ts` loads
  the full catalogue on demand for a name outside the core set, which is the
  designed path for an icon an admin hand-picks by searching — and none of them
  appears in either icon picker's curated grid, the engine's shape icons, or any
  archetype nav, so no first paint reaches for one.
  
  An ignore entry can go blind the way a declared source can, and the consequence
  is worse: it silently stops excluding, and the names return to the entry with
  nothing in the log to say why. So an entry naming a file that is gone, or one
  with no `icon:` literals left to skip, now fails the generator by name.
- @adminium/tokens@0.2.3

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
- f7c9566: Stop addon-a11y auto-running axe so the a11y sweep owns the only run
- f987544: Point `Tag` and `DeltaPill` at the opaque chip tokens too.
  
  The opaque-tint change reached only `Badge` and `IconTile`, because they are the
  only two components that consume `toneSoftClasses` — `Tag` and `DeltaPill` carry
  their own hardcoded `bg-<tone>-soft` variant maps and stayed translucent.
  
  That left the exact defect the change exists to close still live: `SchemaTree`
  gives a selected row `data-[selected=true]:bg-accent-soft/60` and nests
  `<Tag tone="accent">PK</Tag>` inside it — a chip tint composited over a row tint,
  whose contrast depends on what the chip was re-parented onto rather than on the
  chip.
- 08df45d: Stop shipping the whole lucide catalogue: 1,611 icon modules for the 136 the
  product draws.
  
  `Icon` resolved its glyph from a runtime name via `import { icons } from
  'lucide-react'`, and a map import is opaque to a bundler — every icon module was
  emitted, verified in the built source map. Measured cost in the dashboard's
  entry chunk: **112.6 KiB gzipped**, on every cold load.
  
  The icons the product actually renders are now named imports, generated into
  `icon-core.ts` by `scripts/gen-icon-core.mjs` and gated by `--check` plus a test,
  so a new surface cannot quietly fall out of the set. Everything else — an icon an
  admin picked by searching the full catalogue — resolves through
  `icon-resolver.ts`, which loads lucide from a dynamic import and re-renders when
  it lands. Nothing becomes unreachable; the cost moves off the boot path.
  
  `IconName` is unchanged and still the full catalogue: it now comes from `import
  type { icons }`, which is erased. New exports: `useLucideIcon`,
  `loadFullIconSet`, `resolveIconSync`, `pascalCaseIconName`.
- d3a04c8: Let the icon catalogue retry after a failed chunk fetch, instead of staying wrong for the session.
  
  `loadFullIconSet` memoized the dynamic `import('lucide-react')` and never evicted
  a rejected one, so a single stale-deploy 404 or network blip left a permanently
  rejected promise that every later call re-returned. Every icon outside the
  generated core set then stayed wrong until the tab was reloaded — a placeholder
  in this package, and the neutral `File` glyph in the dashboard, which is worse
  because it looks like an answer rather than a gap.
  
  The failure is now evicted, exactly as the dashboard's sibling template loader
  already evicted a failed template id ("a failed chunk must not poison the id
  forever"). The next miss refetches, and because `waiters` is deliberately not
  cleared on the error path, the icons that were already on screen when the fetch
  failed are notified by whichever later attempt succeeds — one recovery heals the
  session.
  
  The handler is a `.catch` after the success handler rather than the second
  argument to the same `.then`: the two-argument form cannot see a throw from its
  own success handler, so a catalogue that arrived unusable would have memoized
  the very promise this exists to prevent.
- 2dffc12: Stop a dead icon name costing a generated app its first paint, and put 64
  untranslated keys into the locale bundles.
  
  - `kanban-square` is not a lucide icon — it was renamed to `square-kanban`. It
    was emitted as `nav.icon` by the page generator, so any generated app with a
    workflow-shaped table fetched the entire ~137 KB icon catalogue on first paint
    to discover the name was dead, then drew the neutral `File` fallback anyway.
    A second instance, `bar-chart-3`, was found by the new gate.
  - `gen-icon-core.mjs` already computed the list of declared-but-unknown icon
    names and discarded it, printing only a count. It now fails in both `--check`
    and write mode, naming the offending file and the canonical rename.
  - `LUCIDE_ICON_NAMES` is now a real export. `allowedIcons` was documented as
    fed by it, that symbol existed nowhere, and nothing supplied the value — so
    the unknown-icon warning and the `table` fallback never fired and a model
    could store any hallucinated icon string on a table.
  - 64 `t()` keys existed in no locale bundle and rendered a hardcoded English
    default in all 8 locales, 56 of them the Settings → Languages & translations
    page itself — the one page whose keys the in-product translation editor
    cannot reach, because it refuses any key absent from the compiled bundle.
    All 8 bundles now carry them, translated rather than copied from English.
- 00cd08f: Refresh the dependency tree, including four runtime majors.
  
  Runtime dependencies that reach consumers: `i18next` 25 → 26, `pino` 9 → 10, `croner` 9 → 10 and `fastify-type-provider-zod` 6 → 7, alongside `fastify` 5.12, `kysely` 0.29, `pg` 8.23, `mysql2` 3.23, `argon2` 0.45 and the `@fastify/*` plugins. Build tooling moved too — `dependency-cruiser` 18, `@changesets/cli` 3, `@types/better-sqlite3` 9 (now matching the `better-sqlite3` 13 it describes).
  
  `i18next` 26 is the one worth knowing about, because the runtime override layer is built directly on 25's semantics: the reason overrides are applied by rebuilding the instance on each revision bump, rather than mutating the resource store, is that i18next cannot delete a key from a bundle — so the store has no way to express "reset this key to the built-in", which is the most common admin operation. That design still holds under 26, and the 171 `@adminium/i18n` tests pass unchanged. `argon2` 0.45 remains Node-API (`napi_versions: [8]`), so the packaging notes about native addons are unaffected.
  
  This release also carries `builtinLocaleDir`, exported from `@adminium/ui`'s theme barrel, which landed earlier without a changeset of its own.
  
  Several things were deliberately held back rather than swept, each for a measured reason, and are recorded in `.github/dependabot.yml` so they stop arriving weekly: `lucide-react` 1.x (+16.1 KiB gz on the dashboard entry chunk, and it drops the brand icons), the `@radix-ui/*` set (+4.8 KiB gz together), `happy-dom` 20 (breaks a desktop About test that passes on 18), and the `vite` 8 cluster (no stable `electron-vite` accepts it). The entry chunk came out of the sweep 0.6 KiB *smaller* than before, so the size ratchet clicked down with it.
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
- Updated dependencies [8477a70]
- Updated dependencies [8477a70]
- Updated dependencies [f987544]
- Updated dependencies [ef1c300]
  - @adminium/tokens@0.2.2

## 0.2.2-rc.0

### Patch Changes

- 00cd08f: Refresh the dependency tree, including four runtime majors.
  
  Runtime dependencies that reach consumers: `i18next` 25 → 26, `pino` 9 → 10, `croner` 9 → 10 and `fastify-type-provider-zod` 6 → 7, alongside `fastify` 5.12, `kysely` 0.29, `pg` 8.23, `mysql2` 3.23, `argon2` 0.45 and the `@fastify/*` plugins. Build tooling moved too — `dependency-cruiser` 18, `@changesets/cli` 3, `@types/better-sqlite3` 9 (now matching the `better-sqlite3` 13 it describes).
  
  `i18next` 26 is the one worth knowing about, because the runtime override layer is built directly on 25's semantics: the reason overrides are applied by rebuilding the instance on each revision bump, rather than mutating the resource store, is that i18next cannot delete a key from a bundle — so the store has no way to express "reset this key to the built-in", which is the most common admin operation. That design still holds under 26, and the 171 `@adminium/i18n` tests pass unchanged. `argon2` 0.45 remains Node-API (`napi_versions: [8]`), so the packaging notes about native addons are unaffected.
  
  This release also carries `builtinLocaleDir`, exported from `@adminium/ui`'s theme barrel, which landed earlier without a changeset of its own.
  
  Several things were deliberately held back rather than swept, each for a measured reason, and are recorded in `.github/dependabot.yml` so they stop arriving weekly: `lucide-react` 1.x (+16.1 KiB gz on the dashboard entry chunk, and it drops the brand icons), the `@radix-ui/*` set (+4.8 KiB gz together), `happy-dom` 20 (breaks a desktop About test that passes on 18), and the `vite` 8 cluster (no stable `electron-vite` accepts it). The entry chunk came out of the sweep 0.6 KiB *smaller* than before, so the size ratchet clicked down with it.
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
- Updated dependencies [ef1c300]
  - @adminium/tokens@0.2.2-rc.0

## 0.2.1

### Patch Changes

- @adminium/tokens@0.2.1

## 0.2.0

### Patch Changes

- 1d7c7b4: Runtime translation overrides, add-on contracts, and Studio navigation.

  `@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

  `@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.

- 1d7c7b4: Cancel `TwoPhaseModal`'s deferred reset timer on unmount.

  The component defers `flow.reset()` past the exit animation so the success phase never flashes back to the form while closing, but cleared that timer only if the modal was closed again before it fired. An unmount in between left it running, so the reset landed on a component that no longer existed — a setState-after-unmount in the app, and in CI a load-sensitive failure where the timer fired after the test environment had been torn down.

  The clear-on-reclose behaviour is unchanged; the two are complementary.

- Updated dependencies [1d7c7b4]
  - @adminium/tokens@0.2.0

## 0.1.0

### Minor Changes

- First public release: the Adminium CLI/server and its library packages.

### Patch Changes

- Updated dependencies
  - @adminium/tokens@0.1.0
