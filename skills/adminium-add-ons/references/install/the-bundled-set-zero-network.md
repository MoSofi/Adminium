<!-- produced from apps/docs/src/content/docs/self-hosting/installing-add-ons.md § The bundled set: zero network; do not edit -->

# Installing add-ons: The bundled set: zero network

The Docker image and the desktop app ship with a **bundled set** of first-party
add-ons: the tarballs and their integrity pins are baked in at build time,
already verified against the release ledger. At boot the server seeds them into
its add-on store — copy-if-absent, with every hash re-verified on the way in —
so the Add-ons page has something real to browse **without a single outbound
request**.

An air-gapped install browses the bundled set, installs from it, enables,
disables, and uninstalls — all of it local file I/O.

Seeding is per-package and best-effort: one unreadable bundle entry is reported
in the boot log and skipped, and the rest still arrive. A bundled package whose
bytes no longer match its integrity sidecar is a corrupt image and is refused
rather than installed.
