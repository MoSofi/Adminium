---
'@adminium/desktop': patch
---

Give the `desktop-v*` release series ownership of GitHub's Latest pointer.

`release.yml` now creates `v*` releases with `--latest=false`, pinned by a
contract test in `docker-contract.test.ts` so a comment is no longer the only
thing protecting it. The desktop publish step is
`gh release edit <tag> --draft=false --latest`, and the draft's own checklist is
generated with the correct command for the tag: a prerelease gets `--draft=false`
without `--latest`, because GitHub refuses the Latest pointer to a prerelease and
an rc must never be what stable installs resolve.

This half is what rescues installs already in the field: their resolution logic
is frozen in the shipped binary and only ever asks `/releases/latest`. The
pointer was moved to `desktop-v0.2.1` on 2026-08-19, so those installs now
resolve a release that actually carries installers.

Also derives `--prerelease` from the tag in `desktop-release.yml`, which
previously marked an `-rc` desktop tag as a stable release.
