---
'@adminium/server': patch
'@adminium/meta': patch
---

**Projects: `adminium new` creates a folder you can open, edit and commit.**

- **Creating a project.** `npx @adminiumjs/adminium new my-admin` creates `my-admin/` and installs
  it. The folder holds:
  - `adminium.config.ts`;
  - a `.env` with a generated secret;
  - an exact `@adminiumjs/adminium` dependency;
  - a Dockerfile that builds on the official image.

  `adminium new` with no name makes the current folder the project: it adds files and never
  changes existing ones. `--sample` creates a small demo SQLite database.
- **Running it.**
  - `adminium dev` runs the project, and restarts it when `adminium.config.ts`, a file it
    imports, or `.env` changes.
  - `adminium build` compiles the config into `.adminium/build`.
  - `adminium start` runs a project from that build.
  - `adminium check` checks a project for CI and exits 2 when something is wrong.
- **Databases.** The databases listed in `adminium.config.ts` are connected when the project
  starts, marked with their key (new meta migration `0033_connection_project_key`). Their pages
  are generated the first time they connect.
- **The default command changed.** `adminium` with no command now creates a project; inside one,
  it lists the project's commands. The setup wizard moved to `adminium try`, and `adminium init`
  still runs it.
