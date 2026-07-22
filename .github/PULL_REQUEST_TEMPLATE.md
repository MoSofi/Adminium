# Summary

<!-- What does this PR do, and why? Link the relevant issue(s). -->

## Tasks covered

<!-- Milestone/task IDs this PR implements or advances (e.g. M0-T02, 01-T04), or the linked issue(s). -->

-

## Checklist

- [ ] I read the header comments of the modules this change touches — they carry the governing spec
- [ ] No inline `style` props (outside the sanctioned `--adm-*` CSS-variable escape hatch — see the Styling section of `CONTRIBUTING.md`)
- [ ] All styling uses `@adminium/tokens` custom properties / Tailwind token utilities — no raw hex, no off-scale spacing or radii
- [ ] Tests added or updated for every behavioral change (Vitest; e2e for user-facing flows)
- [ ] UI changes include screenshots for the full matrix: { light, dark } × { LTR, RTL }
- [ ] A changeset is included (`pnpm changeset`) — or this PR is docs/CI-only and states so here
