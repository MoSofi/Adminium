---
'@adminium/ui': patch
---

Regenerate `icon-core.ts` for the page-builder's six email blocks.

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
