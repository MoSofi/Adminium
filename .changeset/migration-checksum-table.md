---
'@adminium/server': patch
---

**The frozen migration checksums now cover every released migration, not just the first ten.**
`applyMigrations` re-hashes every applied migration on each boot and refuses to start on a
mismatch, which makes the hash a wire format living in databases nobody here controls. Only
0001–0010 were pinned, so the twenty-two migrations 0.2.x shipped had nothing guarding them:
neither an edit to an already-released migration nor a change in tsc's emitted output would have
been caught for any of them, and either one bricks the boot of every existing install.

- **All 32 published migrations are pinned**, each value read out of the published
  `@adminiumjs/meta` tarball that first shipped it rather than from a local build — the tarball is
  the artifact that actually wrote those rows, whereas a local number only proves the tree agrees
  with itself. The blocks record which release froze which values (0.1.0, 0.2.1, 0.2.2, 0.2.3,
  0.2.6) and which later releases re-shipped them untouched.
- **All thirteen published versions were unpacked and cross-checked**, prereleases included. Every
  migration hashes identically in every version that carries it, so the emitted output has been
  stable across the whole release history and no shipped migration has ever been edited. That also
  reproduces the ten existing values exactly, which is what shows the method is sound.
  `@adminiumjs/meta` stops being published once the CLI bundles its internal packages, so this
  captures the values while the tarballs are still fetchable, and the header records where the
  next row comes from instead: the same built file, vendored inside the flagship tarball.
- **A fourth check**: unreleased migrations must sit after every published one, so a new migration
  slotted into the middle of a ledger installs have already run past goes red.
- **The header now names a third failure that wears the same face.** A development meta store can
  hold migrations no release ever published, applied by whatever the tree looked like that day, and
  `MigrationChecksumDriftError` reads identically whether the cause is that or a real regression.
  One such store, kept while 0.2.x was in flight, carries 0015–0018 stamped `adminium_version`
  0.2.2 although the published 0.2.2 stopped at 0014, with 0018 the one whose source changed
  before release. The first thing to check on a drift error is whether the row's
  `adminium_version` is a release that actually shipped that migration.
