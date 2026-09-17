---
title: Pages are settings, not generated code
description: Why Adminium stores a page as a row with a JSON config instead of emitting React components you would then own — and what that means when you add a page feature.
---

## The situation

The obvious way to turn a database schema into an admin panel is to emit code:
read the tables, write a folder of React components, hand it over. It demos
beautifully. The bill arrives at the second run — the schema has moved, the
generated files have been edited, and every upgrade is a merge conflict between
a human and a code generator. Tools built this way tend to be used exactly once
per project and then forked.

## The decision

A page is a **row**, not a file of code. `adminium_pages` holds an id, a
template id (`page-crud`, `page-dashboard`, `page-master-detail`, …), a JSON
config, the connection it belongs to, and its grants. The engine writes those
rows from the schema; the dashboard reads them at request time and renders them
with registry widgets. No component is emitted, ever.

Every row records where it came from, in an `origin` column:
`generated`, `user`, `llm`, `manifest`, `system`, or
[`project`](/anatomy/decisions/project-code-is-trusted/). Regeneration is an
upsert that only ever touches rows it made itself, which is the whole reason a
second run is safe.

The consequences run deep:

- **Editing is a write, not a patch.** Studio's page builder produces the same
  JSON the engine produces.
- **A project folder can hold the same settings as files.**
  [Page files](/projects/page-files/) are that JSON on disk, checked against a
  JSON Schema generated from the same Zod schemas the server validates with.
- **`adminium eject` is deliberately small.** It writes one React file that
  hands the config to `GeneratedPage`. It does not expand a page into
  components, because there are no components to expand it into.

## What it means for a contributor

You are never writing a code generator. A new page capability is three things:
a field in the config schema in `@adminium/engine`, a renderer that reads it,
and a default that makes every existing row keep working.

Two rules follow from that:

- **A new field is optional, or it breaks every install.** Stored documents
  predate your change and will not have it. The envelope schemas in
  `packages/engine/src/config-schema/` are written that way throughout, and the
  comments there record which absences are load-bearing rather than accidental.
  A real format change goes through the config-migration runner instead, which
  keys on `config.v`.
- **Config round-trips.** A block one version does not understand survives being
  read and written by it — `pages-lifecycle.test.ts` checks that for the derived
  block, and the page-file reader is held to the same rule.

The JSON Schemas the project folder ships are generated from those same Zod
schemas by `pnpm project-schemas`, and a gate fails when they drift.
