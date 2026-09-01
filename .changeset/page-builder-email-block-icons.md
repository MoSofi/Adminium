---
'@adminium/widgets': patch
---

Fix: the six email blocks all drew the same placeholder glyph.

`BLOCK_KIND_META` names an icon slug per block and `PageBuilder`'s `BLOCK_ICONS`
maps that slug to a component, with `?? SquareDashed` behind it. The email
flavour's message rail — Heading, Paragraph, Call-to-action, Divider, Spacer,
Footer — was added to the registry without being added to the map, so all six
fell through to the default. Seven of the seventeen rows in the email palette
drew an identical dashed square (the six, plus `block-highlight-box`, which
names that glyph on purpose), and the six sat adjacent at the top of the list
where the difference matters most.

Cosmetic rather than broken: every row keeps its own text label, and the glyph
is `aria-hidden`, so a screen reader was never affected. But it is six controls
a person has to read one by one in a rail designed to be scanned.

The six entries are direct named lucide imports, like the other twenty-two, so
they ride in the page-builder's own lazy chunk. The dashboard's entry chunk
grows by four bytes gzipped — those bindings are already in it for an unrelated
reason (`gen-icon-core.mjs` sweeps this file's `icon:` literals into the
statically-imported core set, which is its own problem and not this one).

**And a test that can see it.** Nothing could, before: the registry test asserts
only that the slug is kebab-shaped, so six unmapped-but-well-formed slugs passed
it; VRT skips this template because `PageBuilder.stories.tsx` carries no `vrt`
tag, so the story that renders the defective palette is never screenshotted; and
axe cannot see a glyph marked `aria-hidden`. Every palette row on every doc type
that has one is now rendered and checked.

The assertion is "draws the placeholder if and only if it asked for the
placeholder" rather than "the rendered class matches the slug", and the
difference is load-bearing. Written the strict way it failed immediately on
`bar-chart-3`, which renders `class="lucide lucide-chart-column"` — a deprecated
lucide alias, still a legal named import, still the right glyph. A class-equality
check would have been red on a name that is fine, and the fix for it would have
been to break something.
