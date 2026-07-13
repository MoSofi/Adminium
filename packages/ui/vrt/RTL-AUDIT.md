# RTL audit — @adminium/ui components (M1-T06/M1-T07, 2026-07-13)

Scope: all 61 component directories under `packages/ui/src/components/` plus
`src/lib`, `src/theme`, `src/styles`, `.storybook`. Method: grep sweeps for
physical-direction Tailwind utilities and CSS properties, plus a manual pass
over every component that renders a directional icon, a directional
animation, or manages arrow-key navigation. The `@adminium/config` lint rule
bans physical utilities at PR time; this audit verifies nothing slipped
through in class strings the rule cannot see (template concatenation,
`cva()` maps, arbitrary values).

## Sweep results

| Check | Pattern | Result |
|---|---|---|
| Physical margin/padding | `ml- mr- pl- pr-` (incl. negative) | **0 hits** |
| Physical inset | `left-N right-N inset-x` (asymmetric) | **0 hits** — the four `inset-x-0` uses (Snackbar, Toast timer bar, BulkActionBar, CommandPalette) are symmetric full-bleed spans, RTL-safe by construction |
| Physical text align | `text-left text-right` | **0 hits** |
| Physical rounding/borders | `rounded-l- rounded-r- border-l- border-r-` etc. | **0 hits** |
| Physical CSS in stylesheets | `margin-left/right`, `left:`, `right:`, `text-align: left/right` in `*.css` | **0 hits** |
| Floats | `float-left float-right` | **0 hits** |

Logical utilities (`ms- me- ps- pe- start- end- border-s border-e text-start
rounded-s`) are used consistently everywhere a side matters.

## Directional icons & mirroring

| Component | Directional element | Handling | Status |
|---|---|---|---|
| `Icon` | any lucide icon by name | opt-in `rtlMirror` prop → `rtl:-scale-x-100` | OK |
| `Breadcrumbs` | `ChevronRight` separator | `rtl:-scale-x-100` | OK |
| `Pagination` | `ChevronLeft`/`ChevronRight` prev/next | `rtl:-scale-x-100` on both | OK |
| `DeltaPill` | trend arrow | `rtl:-scale-x-100` | OK |
| `Select`, `Combobox`, `NumberStepper` | `ChevronDown`/`ChevronUp` | vertical — no mirroring needed (correct) | OK |
| Button stories | `ArrowRight` in "Continue" | `rtl:-scale-x-100` at call site (per §3.4 the consumer mirrors semantic-direction icons) | OK |

## Directional animation & layout

| Component | Concern | Handling | Status |
|---|---|---|---|
| `Toast` | slide-in from inline-end | `nb-toastin` / `rtl:animate-[nb-toastin-rtl…]` | OK |
| `Drawer` | slides from `inset-inline-end` | logical inset + `rtl:[--nb-slide-from:-24px]` flip | OK |
| `ProgressBar` | fill grows from inline-start | `origin-[0%_50%]` + `rtl:origin-[100%_50%]` | OK |
| `AvatarStack` | −8px overlap | logical `-ms-2` | OK |
| `SegmentedControl`, `ChoiceChips` | roving arrow keys | forward/backward key sets swap when `direction === 'rtl'` (Radix `useDirection`) | OK |
| `Tabs`, `Radio`, `Slider`, `DropdownMenu`, `Popover`, `Tooltip` | Radix arrow-key/placement mirroring | inherited from `DirectionProvider` mounted by `ThemeProvider` | OK |
| `OtpInput` | digit groups must stay LTR in RTL locales | container forces `dir="ltr"` (bidi isolation, numerals) | OK |
| `NumberStepper` | chevron column border | logical `border-s` | OK |

## Per-component status

All 61 components pass the sweep. Components not named above contain no
direction-sensitive markup beyond logical utilities: alert,
autosave-indicator, avatar, badge, banner, bulk-action-bar, button, card,
checkbox, chip-input, command-palette, confirm-modal, count-badge,
date-input, divider, dropdown-menu, empty-state, filter-chip, form-field,
icon-button, icon-tile, input, input-group, kbd, key-value-list, label,
modal, mono-text, otp-input, password-strength, popover, progress-bar,
radio, radio-card, search-input, secret-input, skeleton, slider, snackbar,
spinner, status-pill, stepper, success-state, switch, tag, textarea, toast,
tooltip, two-phase-modal.

## Follow-ups (none blocking)

1. The `rtl` and `dark-rtl` VRT profiles (vrt/vrt.spec.ts) pin all of the
   above visually once baselines are captured — any regression to a physical
   utility shows up as a mirrored-layout diff.
2. `DateInput`/`TimeInput` render native pickers; the popup calendar is
   browser chrome and follows the page `dir` — nothing to do in-library, but
   the M8 i18n audit should verify week-start handling at the app layer.
3. `Kbd` shortcut glyphs (⌘K etc.) are deliberately **not** mirrored
   (15-quality.md §8.3 "unmirrored shortcuts") — current behavior correct.
