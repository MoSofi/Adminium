---
'@adminium/ui': patch
---

Point `Tag` and `DeltaPill` at the opaque chip tokens too.

The opaque-tint change reached only `Badge` and `IconTile`, because they are the
only two components that consume `toneSoftClasses` — `Tag` and `DeltaPill` carry
their own hardcoded `bg-<tone>-soft` variant maps and stayed translucent.

That left the exact defect the change exists to close still live: `SchemaTree`
gives a selected row `data-[selected=true]:bg-accent-soft/60` and nests
`<Tag tone="accent">PK</Tag>` inside it — a chip tint composited over a row tint,
whose contrast depends on what the chip was re-parented onto rather than on the
chip.
