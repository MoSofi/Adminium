# Summary

<!-- What does this PR do, and why? Link the relevant issue(s). -->

## Tasks covered

<!-- List the workplan task IDs this PR implements or advances, e.g. M0-T02, 01-T04. -->

-

## Checklist

- [ ] I read the governing workplan doc(s) for this change (`workplan/0X-*.md`) before writing code
- [ ] Task IDs covered are listed above (`M{n}-T{nn}` and/or `0X-Tnn`)
- [ ] No inline `style` props (outside the sanctioned `--adm-*` CSS-variable escape hatch — see `workplan/02-design-system.md` §8)
- [ ] All styling uses `@adminium/tokens` custom properties / Tailwind token utilities — no raw hex, no off-scale spacing or radii
- [ ] Tests added or updated for every behavioral change (Vitest; e2e where the workplan requires it)
- [ ] UI changes include screenshots for the full matrix: { light, dark } × { LTR, RTL }
- [ ] A changeset is included (`pnpm changeset`) — or this PR is docs/CI-only and states so here
