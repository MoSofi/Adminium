---
'@adminium/server': patch
---

Build the coverage harness 15-quality.md §1 has specified since M0 (task 15-T01)
and nothing implemented: no `coverage` key in any of the 9 vitest configs, no
provider installed, nothing in CI.

Every package with tests now carries `coverage.thresholds`, from a shared base at
`@adminium/config/vitest`. Nine packages that had tests and no vitest config at
all — engine, schema-import, llm, tokens, adapter-mysql, adapter-sqlite,
manifest, add-on-contracts and config — get one.

**The first measurement was wrong, and the reason is the interesting part.**
Measured with vitest's default excludes, apps/server reports 81.2% over 2,787
files: 107,165 statements of node_modules and 79,761 of workspace `dist/` are in
the denominator, and 219 apps/dashboard files are mis-attributed to
`apps/server/src/...` paths that do not exist on disk. Scoped to its own src it
is 90.54% over 212 files. `packages/ui` was worse than wrong — it counted ~82,000
statements of gitignored `storybook-static/`, which exists in the `vrt` job and
not in `verify`, so the same commit measured 4.66% in one job and 54.64% in
another. An `exclude` list cannot fix either case; `include: ['src/**']` can, and
is why it is there.

Floors are `max(§1 floor, measured rounded down)` per axis: green on arrival and
ratcheting upward only. A floor set at §1's numbers would have been red on
arrival — which is how the VRT and axe gates died the first time. Rounding down
is not cosmetic: v8 totals are not bit-stable between identical runs.
`@adminium/ui`, `@adminium/widgets` and `@adminium/charts` collect and report but
assert nothing, per §1.

Two RELEASE-GATE rows record what is still owed, both unchecked: the gap between
the ratchet and §1's floors, and the fact that 9 of 10 performance budgets have
no harness and no recorded decision either way. The previous state was worse than
an unmet criterion — with no row, the gate could not fail on it.

Coverage adds ~15% to the test leg, so `verify`'s timeout goes 20 → 25 minutes,
and summaries upload as an artifact on failure only.

Coverage is enabled by `--coverage` in each package's `test` script rather than
unconditionally in the config. Thresholds apply to whatever was collected, so a
deliberate subset legitimately has low coverage: with it always on,
`vitest run one.test.ts` printed "12 passed" and then exited non-zero on
"Coverage for statements (0.43%) does not meet global threshold (90%)" — every
single-file debugging run looked like a failure. The full-suite path, and
therefore CI's `turbo run test`, is gated exactly as before.
