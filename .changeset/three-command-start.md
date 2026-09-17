---
'@adminium/server': patch
'@adminium/docs': patch
---

**A fresh clone runs the admin panel in three commands.**

- **`corepack enable`, `pnpm install`, `pnpm dev`** — and nothing else. `pnpm dev` now runs
  `scripts/dev-setup.mjs` first, which writes a `.env` with an `ADMINIUM_SECRET` (generated once
  and **never** regenerated, because it derives the key that encrypts every stored DSN) and builds
  `.dev/sample.db` from the desktop app's demo company, pointing `ADMINIUM_SOURCE_URL` at it. The
  first boot then connects a database and generates pages instead of opening an empty panel. A
  source you configured yourself, in `.env` or in the shell, is never overridden, and a step that
  cannot run is reported and skipped rather than failing the command.
- **No separate build step**: `turbo run dev` gains `dependsOn: ["^build"]`.
- **`CONTRIBUTING.md`, the README and the docs contributing page** are rewritten around those
  three commands, with the comment rule ("say what the code does and why, and leave the history to
  git") and a pointer to the public decision pages. The package maps gain the two workspaces they
  had been missing, `add-on-contracts` and `public-client`.
- **`pnpm dev-setup --print`** says what the setup step would do without doing it.
