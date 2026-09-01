---
'@adminium/server': patch
---

Installed add-ons now run: server halves load, contracts resolve, and their
events become job kinds.

O1 was ratified in-process, on the recommendation the plan records — 24 D13's
first-party publisher gate is what does the real work. This implements that
ruling, and because it does, the loading discipline is the whole of the control.

A server half is loaded **only** from the installed bundle on local disk,
**only** at a path the manifest declares, and **only after** the file is
re-hashed against the pin recorded when the package was unpacked. The refusal
happens before the import rather than after, which is the difference between
refusing to run modified bytes and noticing that you did. That check is more
consequential than the one on the bundle-serving route: that one protects a
browser, this one protects the server process.

A failure is contained to one add-on. A boot that died because one bundle was
corrupt would take an entire instance down for one broken integration, which is
the opposite of the trade this design makes — so every failure becomes a
reported problem and the rest of the set still loads.

**Two add-ons implementing one contract is normal, not a conflict.**
`artwork-source@1` already has two, so resolution is a choice rather than a
lookup, made deterministically by add-on key so two instances of the same
deployment agree. Slot fills order by `order` then key — never by install
sequence, which differs between machines. A `single` slot claimed twice records
SLOT_CONFLICT naming the loser: a silent override would leave an operator
looking at a slot filled by an add-on they did not expect with nothing anywhere
saying why.

**Events become job kinds on the shared registry**, namespaced
`add-on:<key>:<event>` so an add-on called `export` declaring an event `run`
cannot shadow the exporter. That buys the worker's retries, cooperative
cancellation and `jobs:<jobId>` progress for free rather than reimplementing
them worse. The kinds are internal-only for the same reason `add-on-download`
is: the payload reaches in-process third-party-shaped code, and a `jobs.manage`
holder able to author it would be feeding that code arbitrary input past
whatever the emitter would have checked.

The handler contract is defined in that module because nothing else defined it —
a manifest's `events[]` names `{ on, server }` and says nothing about what the
module exports. A module that does not implement it is refused and named rather
than registered: a kind whose handler cannot run is worse than no kind, since
the job would be enqueued, retried three times, and fail with a message about a
missing function instead of about a broken add-on.

The credential is resolved per run rather than captured at registration, so one
rotated or disconnected between boot and now is the one the handler sees. And
this is where the guarded outbound client finally has a call site: it is what an
add-on is handed, built from its own manifest so no caller can widen the
allow-list.

One bug fixed on the way past: `@adminium/manifest` was a devDependency while
`routes/add-ons` imported it at runtime — and the Dockerfile's `pnpm deploy
--prod` excludes devDependencies, so the published image would have failed to
import it. It and `@adminium/add-on-contracts` are now runtime dependencies.
