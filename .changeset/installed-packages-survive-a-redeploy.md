---
'@adminium/server': patch
'@adminium/meta': patch
---

**An installed app or add-on now survives a deploy that empties the data directory.**

On DigitalOcean App Platform, or any container without a volume, every deploy
starts with an empty `ADMINIUM_DATA_DIR`. The meta store remembers each
install; the files do not survive. Until now the only packages that came back
were the ones the image happens to bundle at exactly the installed version —
so every app, every add-on you uploaded, and every add-on you had updated past
the image's copy was gone, and had to be installed again by hand after every
single deploy.

When a storage destination is configured, Adminium now keeps a copy of each
installed package there and stages it back at boot.

**What the copy is.** `stage()` verifies a tarball, unpacks it and discards it,
so by the time anything wants to keep a copy the bytes it arrived as are gone —
for a package installed a moment ago as much as for one installed last year.
The copy is therefore a repack of the staged tree, and its fingerprint is
recorded per install (`adminium_manifests.package_integrity`, migration 0037).
That fingerprint is of *our* repack, not of the publisher's tarball, so it is
deliberately never compared with a catalog row or the release ledger: it
answers only "are these the bytes this instance put there", which is the
question the restore asks.

**Where it lives.** An ordinary file row of the new kind `package`, which keeps
it clear of the daily sweep — that collects unattached `upload` rows after 24
hours, and a package copy is attached to no record by design. A copy written as
an upload would have been deleted overnight and the loss discovered only by the
redeploy it existed to survive.

**A local destination is not a copy.** If the default destination is this
server's own disk, nothing is written and nothing is recorded: that is the disk
being emptied, and a fingerprint there would claim a package was protected by a
copy that dies with the original.

**Ordering.** The restore runs after the bundled seeds and before the add-on
runtime is built and before the missing-package report — all three behind one
promise. 0.2.9 built the runtime 60–90 ms ahead of the seed and the add-on
stayed dark until an unrelated toggle; a restore landing after the runtime
would be the same defect one step along, so `compose.ts`'s wiring is pinned in
source and a two-boot test drives it for real.

**Instances that predate this** become protected without reinstalling anything:
the same boot pass uploads a copy of every installed package that does not
already have one, and skips the ones that do.

A package that still cannot be restored — no copy held, the destination
unreachable, a fingerprint that does not match — is not silently ignored: the
boot says which and why, and it continues to read as **Missing** in Studio.
