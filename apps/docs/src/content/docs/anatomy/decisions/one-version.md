---
title: One version for every package
description: All twenty-one workspaces move on a single version number, every bump is a patch, and the version is a release identifier rather than a claim about any one package.
---

## The situation

A monorepo with independently versioned packages spends real effort on a
question nobody outside it cares about: which of the twenty-one workspaces
changed, and by how much. Independent versions also make a support conversation
harder, not easier — "which version are you on?" stops having one answer.

Adminium ships as one thing. The server, the dashboard build and the internal
packages the server loads are all inside
[one npm package](/anatomy/decisions/one-npm-package/); the desktop app is that
same server wrapped in Electron. Nobody installs `@adminium/engine` at a
version of their choosing, because nobody installs it at all.

## The decision

**One version, everywhere.** changesets is configured with a single `fixed`
group covering `@adminium/*`, so a change to one workspace moves all
twenty-one to the same number. The published `@adminiumjs/*` packages carry that
same number.

**Every bump is a patch.** The `fixed` group promotes the highest bump in a
release onto every workspace in it, so one `minor` changeset would move the
whole train to a minor. The convention is therefore to write `patch` and let the
release notes carry the meaning.

**The number identifies a release, not a package.** `0.2.9` of
`@adminium/tokens` does not claim that tokens changed in `0.2.9`; it claims
that this is the copy of tokens that shipped in the `0.2.9` release. Read the
changelog for what actually moved.

## What it means for a contributor

- **Every behaviour-changing pull request gets a changeset** —
  `pnpm changeset`, bump level `patch`, and a summary written for the person
  reading release notes rather than for a reviewer. Docs-only and CI-only
  changes may skip it; say so in the description.
- **Do not reach for a minor or a major** to signal that your change is
  significant. It promotes across twenty-one workspaces and makes the release
  say something the maintainer did not intend.
- **Internal dependency ranges move themselves.** `updateInternalDependencies`
  is set to `patch`, so cross-workspace ranges are rewritten by the release, not
  by hand.
- **The published four have one extra requirement**: a `repository` field.
  Trusted publishing on npm will not accept a package without it.

[The packages, one by one](/anatomy/packages/) lists which four are published
and what each of the rest is for.
