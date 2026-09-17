---
'@adminium/server': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

**Projects: pages and schema customizations are files.**

- **The files.** A project keeps each page in `pages/<address>.json` and each database's
  customizations in `schema/<database>.json`. Files name databases by their key in
  `adminium.config.ts`, never by an id, so the same files work on every install. Each points at a
  JSON Schema the package ships (`schemas/`), so editors can complete them.
- **In `adminium dev`** the files are the master copy. A saved file is applied at once without a
  restart. A Studio edit is written back to its file. A file with a mistake is reported with its
  field and not applied.
- **On a server** (`adminium start` in a project, or its Docker image), deployed files are applied
  at start. A page edited in Studio there is kept and marked "changed on server". Studio → Pages
  shows the command that pulls it, and settles a page changed on both sides.
- **`adminium pull`** writes the files from the project's database.
  `adminium pull --from <url>` writes the pages a server changed (`GET /api/v1/project/export`,
  with an `ADMINIUM_API_KEY` whose role has the new `system:project:read`, which Admin gets).
- **`adminium check`** validates every page and schema file with no database.
- **`adminium new`** in a folder that already holds an instance (or with
  `--import <folder>`) makes its connections the project's databases and writes its pages as files.
- **New meta migration** `0034_project_files`.
