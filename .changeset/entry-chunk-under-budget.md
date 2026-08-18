---
'@adminium/ui': patch
---

Stop shipping the whole lucide catalogue: 1,611 icon modules for the 136 the
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
