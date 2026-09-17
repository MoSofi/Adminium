---
title: Add-ons are trusted because they are first-party
description: An add-on's server half runs in the host process with no sandbox, so the whole trust decision happens at install time — and the loading path is deliberately narrow.
---

## The situation

An add-on extends a running Adminium: it can add routes, fill UI slots, provide
a capability another add-on consumes, and read tables the operator scoped to it.
There are two ways to allow that.

**Sandbox it.** Run the server half in a worker or a subprocess, behind a
message channel, with a capability API instead of the host's objects. That is
real isolation, and it is also a second runtime to build, version and debug —
plus every useful thing an add-on wants to do has to be proxied through it.

**Trust it, and control what gets installed.** No isolation, but a narrow gate
at the only moment that matters.

## The decision

The second one. An add-on's server half is imported into the host process and
runs as host code, with no sandbox. Everything else follows from accepting that
honestly rather than pretending otherwise.

**The gate is the publisher.** A manifest is rejected unless
`publisher.id` is `adminium`. The `third-party-publishers` flag that would
relax it exists and is off. An unsandboxed in-process add-on from an unknown
publisher is remote code execution with a nice install button in front of it,
so the check is not a formality.

**The loading path is as narrow as it can be made:**

- **Only from the installed bundle on local disk.** Not a URL, not a registry,
  not `eval`, and never a path the caller supplies.
- **Re-hashed against the pin before import.** The bytes are checked against the
  per-file SHA-256 recorded at unpack, so a package edited on the data volume
  after installation is not imported. A serve-time check protects a browser;
  this one protects the server process, which is the more consequential of the
  two.
- **Only a path the manifest declares** — the `server` entry of a `provides`
  block, never an arbitrary file inside the package.
- **A load failure is contained.** One broken add-on is recorded, reported and
  skipped. It does not stop a boot or fail an unrelated request.

**The provider registry is rebuilt, never patched.** Install, uninstall,
disconnect, disable-per-host and upgrade all rebuild the whole map. An
incremental registry has to get removal exactly right on all five paths, and
getting it wrong leaves a provider answering for an add-on the operator believes
is gone. Rebuilding costs O(installed add-ons), which is a number in the low
tens.

## What it means for a contributor

- **Do not add a load path.** Anything that imports add-on code from a
  caller-supplied path, a URL, or bytes that have not been re-hashed is the one
  change this decision exists to prevent.
- **Do not treat a manifest as trusted input.** It is validated with Zod before
  anything reads a field, and the validator is pure so the browser can run it
  too.
- **A conflict is recorded, not resolved silently.** Two add-ons may legitimately
  implement one contract; a single-fill slot claimed twice is surfaced, not
  decided by load order.

[Installing add-ons](/self-hosting/installing-add-ons/) is the operator-facing
side, and [the manifest spec](/reference/manifest/) is the schema itself.
