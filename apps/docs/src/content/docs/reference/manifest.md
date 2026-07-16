---
title: Manifest spec
description: The manifest format for marketplace modules — status, scope, and what is frozen.
---

:::caution[Not shipped yet]
The manifest spec and the marketplace are **not part of this release**. This page
exists so the URL is stable and so you know what the word means when you see it
elsewhere in these docs.

Nothing here is implemented. Do not build against it yet.
:::

## What a manifest will be

A **manifest** is how a marketplace module declares itself to Adminium: the
tables it needs, the pages it contributes, the roles it defines, and the
settings it exposes. Adminium validates it, installs it, and the module's pages
appear in the sidebar.

The format is JSON, validated by a published JSON Schema, carrying an integer
`manifestVersion` — the same versioning discipline as the
[schema IR](/guides/schema-import/json-ir/), for the same reason: a document
that declares a version keeps working when the format grows.

## Why it is not here yet

The manifest spec is frozen when the marketplace ships, not before. Freezing a
contract that nothing has implemented against produces a contract that is wrong
in ways nobody has discovered.

## What exists today

If you want to move an Adminium configuration between instances now, that is
`export-zip` — a different thing, doing a different job:
[Export & restore](/self-hosting/export-zip/).

If you want the schema format Adminium's import pipeline speaks today, that is
the IR, and it is real, published, and versioned:
[The JSON IR](/guides/schema-import/json-ir/).
