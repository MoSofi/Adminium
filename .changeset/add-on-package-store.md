---
'@adminium/server': patch
'@adminium/meta': patch
---

Add-ons can now be acquired: a package store, a hardened unpack, and a catalog client.

Plan 26 specs everything that happens once an add-on package is on local disk —
validate, install, connect, enable per surface, uninstall — and deliberately
assumes the package is already there. Nothing put it there. This is the
acquisition half: where a package comes from, how its bytes are authenticated,
and how they get onto disk without the archive being able to decide where.

**The store** (`apps/server/src/add-ons/store.ts`) keeps packages at
`<ADMINIUM_DATA_DIR>/add-ons/<key>/<version>/`, a sibling of `files/` on the
same named volume, so downloads survive an image upgrade the way exports and
backups already do. It clones `files/storage.ts`'s fail-closed discipline and
adds the two things a code package needs that a byte blob does not: a version in
the path, and a tree that is written atomically. `adminium_files` was not reused
— a `file_<ULID>` key has nowhere to put a version, `FileKind` has no member
that fits, and a package is a tree the runtime serves individual files out of,
not a blob.

**Unpack treats every archive as hostile** (`add-ons/archive.ts`). It has to: an
add-on ships a server half that runs in-process, so distribution is an RCE
channel, and the publisher gate in `@adminium/manifest` cannot run until
`manifest.json` has already been extracted — the field it reads lives inside the
attacker's archive. So the reader is an allowlist. Symlink, hardlink, device,
FIFO, PAX and GNU long-name entries are refused by name rather than skipped;
absolute paths, `..` components, backslash separators and control bytes are
refused; the header checksum is verified; GNU base-256 size fields are refused
(they describe members over 8 GiB, three orders of magnitude past the cap, so in
practice they only appear from something trying to confuse a size check); a
duplicate path is refused, because last-write-wins is how you show a scanner one
file and the runtime another. Archive mode bits are read for the checksum and
then discarded — files land 0o600 whatever the tarball asked for.

Decompression is bounded by measurement, not by hope. `gunzipSync` would
materialise the whole expansion before any cap could look at it, so the reader
streams through fflate's `Gunzip` and aborts from the chunk callback; fflate
flushes on a fixed internal buffer, so overshoot past the cap is one chunk —
16 MiB for 64 MiB, 256 MiB and 1 GiB bombs alike, since the first chunk does not
scale with the bomb. Worst-case allocation is the cap plus 16 MiB regardless of
what the archive claims. No new dependency was added for any of this: `fflate`
was already here for the export/backup zip paths, and a hand-written strict
header reader is more auditable on an RCE path than a general-purpose extractor
being argued out of extracting. The strictness costs nothing in compatibility —
a real `npm pack` tarball is pure USTAR, regular files only, every path under
`package/`, which is what the reader accepts.

**The stage-to-install window is closed by a tree pin.** The data volume is
shared, writable state, so between unpack and install anything with write access
could edit the tree. `stage()` records a per-file sha256 manifest; `verifyTree()`
re-checks it before install parses a byte, and refuses an ADDED file as well as a
changed one — pinning only the files you know about would let a writer drop an
extra module beside them for the runtime to load.

**The catalog client** (`add-ons/catalog.ts`) is built on the telemetry client's
precedent, including the part that matters: the off-switch is checked before a
URL is constructed, so there is no code path from a disabled client to `fetch`.
Two independent vetoes, either sufficient — `ADMINIUM_NETWORK_FEATURES` for
whoever owns the process environment, and a new default-off
`addOns.catalogEnabled` setting for whoever administers the instance. Exactly two
hostnames are reachable, both module constants; the tarball URL is the one
address that arrives as remote data, so its host is compared with `===` against
the registry constant before it is fetched. The feed schema is `.strict()`, which
is what makes deferred monetization a rule rather than a coincidence: a feed
carrying `price`, `tier` or `licenseKey` is refused, not ignored. Versions are
exact — the schema rejects `latest`, `^1.0.0` and `1.x` outright.

`add-on-network-isolation.test.ts` proves the off-path the way
`telemetry-network-isolation.test.ts` does, with a recording thrower over fetch
and node net/http/https: a client that swallowed its own fetch failures would
otherwise turn "off means off" into "off means we tried", and a
non-throwing-result assertion would not notice.

The transport carries three properties that the exact-hostname rule needs and
that a plain `fetch` call does not give you. **Redirects are refused, not
followed** — this is the load-bearing one. A host check necessarily runs on the
URL *before* the request, so with `fetch`'s default a `302 Location:
https://evil.example/x.tgz` out of the registry would be followed silently and
"exactly two hostnames" would hold only on paper; both endpoints are first-party
or first-party-pinned and neither has any business bouncing us, so a redirect is
a typed refusal that names where it tried to send us. **Responses are capped
while streaming**, because the archive limits bound what is *unpacked* and by
the time they see anything the bytes are already in memory — a declared
over-cap `content-length` is refused before a byte is read, and a body that lies
about its length is cancelled mid-stream. **Every request carries a wall-clock
budget**, so a host that accepts a connection and never answers cannot park a
job forever.

**Acquisition runs as jobs, not request handlers** (`jobs/add-on-acquire.ts`).
A download is a multi-second chain — packument pin, ledger cross-check, tarball,
verify, unpack — and the jobs substrate already carries retries, cooperative
cancellation, and progress on the `jobs:<jobId>` WS topic that the Studio page
will consume for free. `add-on-download` is registered INTERNAL-ONLY: its
integrity value comes from the cached catalog, so a `jobs.manage` holder able to
hand-craft the payload through `POST /jobs` would be choosing their own integrity
value, which is the same as having none. Idempotency is the repo's own
`dedupeKey` per `(key, version)`, so two operators pressing Download get one
download. `catalog-refresh` is scheduled daily and is a no-op — not a failure —
when the switch is off.

Both a refusal and a success are audited, under a new `add-on` audit category.
It gets its own category rather than a `system` action because an add-on runs
code in-process: "what arrived on this deployment, from where, and did anything
refuse it" is a question an operator asks on its own, and should not have to be
sieved out of the system log. The column is `str(20)` with no CHECK constraint,
so this needed no migration.

All of this was then attacked from three independent lenses and every claimed
defect adversarially verified before being believed — 14 of 27 survived, and
the survivors were the useful kind. `fflate` does not validate the gzip footer,
so a stream with a wrong CRC32 and ISIZE was being accepted; a single zero block
mid-stream desynchronised the parser in a way that made system `tar` and this
reader disagree about how many members an archive has, which is a parser
differential a scanner could be walked straight past; the ustar magic was never
checked at all, so a v7 or GNU header was being read at ustar offsets; versions
sorted lexicographically, which puts `1.10.0` below `1.9.0`; the bundled-seed
filename regex was non-greedy and split a hyphenated key at the wrong hyphen;
the tree pin lived inside the directory it pinned, so a package could ship its
own; the temp directory was named from the tarball hash alone, so two concurrent
stages of the same bytes collided; and the replace step removed the outgoing
tree before renaming the new one in, so a failure mid-swap left neither.

Four more came out of the same pass. The feed's `npmPackage` accepted any name
up to npm's 214-character limit while `pinRelease` built the packument URL from
it — so whoever served the feed chose which package a download actually fetched,
and the D7 cross-check gave no protection at all there, because the same
attacker supplies both the name and the `integrity` it is compared against. It
is now bound to `@adminiumjs/add-on-<key>` by a schema refinement. The job's
cancellation signal reached none of the network calls, so a cancelled download
held its socket until the timeout; the tarball leg had no audit row, making the
audit trail's completeness depend on which failure happened to occur; and the
memory-bound comment claimed "the cap plus 16 MiB" when the accumulated chunks
and the flat copy assembled from them are both alive at once — roughly twice the
cap, which is what it now says.

At boot the store prunes orphaned staging directories (an atomic-rename scheme
leaks exactly those on a SIGKILL) and seeds the image's bundled set
copy-if-absent, re-verifying every hash on the way in — so "pre-verified" means
the hash is checked again, not that the check is skipped. That is what lets an
air-gapped install browse and install with no registry reachable at all.
