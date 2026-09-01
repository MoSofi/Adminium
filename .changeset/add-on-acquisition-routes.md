---
'@adminium/server': patch
---

A package can now reach a deployment over HTTP: browse, refresh, download,
sideload, discard, upgrade.

The loop had a hole in the middle. The store, the catalog client and the two
acquisition jobs all existed, and nothing enqueued a download — so a package
could only arrive through the image's bundled seed, and install had nothing to
install otherwise. These are the six routes that close it, all behind
`manifests.manage` and all audited.

**Browse never touches the network.** `GET /add-ons/catalog` is a disk read:
the packages already staged, merged with whatever the last refresh cached, each
row labelled with where its bytes would come from and whether anything has to be
downloaded first. That is what makes the page work identically on an air-gapped
install, and what stops a page load from becoming an outbound call nobody asked
for. Refresh and download refuse with a reason when the online catalog is off,
checked at the route as well as inside the job — an operator pressing a button
deserves an answer, not a job that reports "disabled" into a log they are not
reading.

**Sideload runs the identical path as a download.** D4 makes it a first-class
source rather than an escape hatch, so an uploaded tarball goes through the same
verify-then-hardened-unpack the npm path uses: same integrity check, same
allowlist extractor, same tree pin, same staged result. An air-gapped operator
gets the same guarantees rather than a softer set. The tarball travels as a raw
`application/octet-stream` body with the two scalars as query parameters,
because this server has no `@fastify/multipart` and adding one for a single
route would be a new dependency on the RCE path — the established idiom here is
a scoped content-type parser plus a route-scoped `bodyLimit`.

**Declining to install is not a dead end.** A staged package can be discarded
without installing it first, which is the only way downloaded bytes an operator
decided against ever leave the disk. Discarding the version that is *installed*
is refused: that path is uninstall, which has different consequences and its own
confirm.

**Upgrade is a version bump, not a reinstall.** The hosts an add-on is mounted
on and the credential it was given both survive it. The staged tree is re-hashed
against its unpack-time pin and re-validated through the full validator, so an
upgrade cannot smuggle past the publisher gate what an install could not; and
`attaches` is re-checked, because a new version may have dropped a host this
instance is currently mounted on and upgrading into that would leave an
attachment the manifest no longer claims to support. Older version directories
are pruned only after the upgrade verifies, so a failure anywhere above leaves
the running version on disk.

One thing the tests found: discarding the only staged version left an empty key
directory behind, and `keys()` — which matches directory names against the key
grammar — went on reporting an add-on with no bytes anywhere. It now sweeps the
key directory when its last version goes, guarded on emptiness so an upgrade
pruning an old version does not take the key with it.
