---
'@adminium/server': patch
'@adminium/meta': patch
'@adminium/engine': patch
'@adminium/widgets': patch
'@adminium/charts': patch
'@adminium/i18n': patch
'@adminium/ui': patch
'@adminium/tokens': patch
---

Let admins create and edit pages from Studio, and give every screen one gutter.

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
