---
title: One npm package
description: The internal packages ship inside the flagship tarball rather than beside it on the registry — why that beats both fourteen packages and a single re-bundled file.
---

## The situation

Adminium's source is twenty-one workspaces. Up to `0.2.9` that meant fourteen
of them were published to npm, and installing the CLI downloaded all fourteen
plus everything each one declared: about 245 packages and 220 MB, including
React, Radix and Leaflet — browser libraries the server never loads, pulled in
because the package that *registers* widgets also declares what *renders* them.

That is a poor trade in three directions at once. It is slower to install, it
publishes a dozen packages nobody was meant to depend on directly, and each of
those names is a supply-chain surface that has to be defended forever.

## The decision

**Four published packages**: the flagship `@adminiumjs/adminium`, plus
`public-client`, `manifest` and `add-on-contracts`, which other repositories
genuinely install.

**The internal packages travel inside the flagship tarball.** They are listed in
`bundleDependencies`, so npm unpacks them from the tarball and never asks the
registry for them. They keep their source names, so
`node_modules/@adminium/engine` inside the package is exactly what it says.

**Their copies declare no dependencies of their own.** The flagship declares the
third-party libraries they actually load, found by tracing the built code rather
than by trusting the manifests — which is how the browser libraries stop being
installed. An install is now about 170 packages and 150 MB.

## Why not re-bundle it into one file?

Because the code reads files next to itself. Migrations, locale bundles, JSON
schemas, the snapshotted LLM vocabularies and the email assets are all loaded
from disk at runtime. A bundler that inlines the JavaScript leaves every one of
those lookups pointing at a path that no longer exists, and finding them all is
a search for every dynamic read in a large codebase — with the failure mode
appearing on someone else's machine.

Real folders in the tarball keep every one of those reads correct, at the cost
of a slightly larger package. That is the cheaper mistake.

## What it means for a contributor

- **Adding a runtime dependency to a bundled package is a two-step change.**
  Declare it, then run `pnpm server-runtime-deps` so the traced list is
  regenerated; `pnpm server-runtime-deps-check` fails in CI when the trace and
  the list disagree.
- **Never let the server import a browser package.** `ui`, `charts` and
  `tokens` are deliberately not in the tarball. If a server module reaches one,
  the fix is the import, not the list — `pnpm check-deps` and the runtime-deps
  gate both exist to catch it.
- **Do not publish a new workspace** without a reason that outlives the release.
  The default is internal and bundled.
- **The published four need a `repository` field.** Trusted publishing on npm
  rejects a package without one.
- **Never write `npx adminium`.** The unscoped name belongs to an unrelated
  package, and a docs gate fails on a line that names it without saying so. The
  scoped name is `@adminiumjs/adminium`; the binary it installs is still called
  `adminium`.

[How Adminium works](/anatomy/#1-what-npx-adminiumjsadminium-actually-runs)
shows the tarball's layout, and
[one version for every package](/anatomy/decisions/one-version/) covers why all
twenty-one move together.
