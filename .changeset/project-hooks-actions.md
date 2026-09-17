---
'@adminium/server': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
'@adminium/widgets': patch
'@adminium/public-client': patch
---

**Projects: hooks and actions.**

- **One write path.** Every insert, update and delete Adminium makes in a connected database now
  goes through one service: the data API (single rows, bulk and undo), the public API, automation
  steps and CSV imports. A test fails when a new direct write appears anywhere else. With no hooks,
  every path sends the same statements as before.
- **Hooks.** A file in a project's `hooks/` (`export default defineHook({ … })`) runs before or
  after a record is created, changed or deleted. Before hooks may change the values or
  `reject(message)`, which fails the write with 422 and the hook's message everywhere, including
  bulk edits, CSV imports (in the error report) and the public API (the new code
  `PUBLIC_WRITE_REJECTED`). After hooks run once the change is saved; their errors are logged and
  shown in Studio. Imports run after hooks only for hooks that set `onImport`. Writes a hook makes
  through `db` run hooks too, and a chain deeper than three is stopped.
- **Actions.** A file in `actions/` (`export default defineAction({ … })`) adds a button to the
  record page, each row's Actions menu and, with `bulk`, the bulk bar. `GET /api/v1/project/actions`
  lists the ones the caller may run, and `POST /api/v1/project/actions/:id` runs one with the
  person's permission, a time limit and a `project.action` audit entry.
- **The `db` helper** gives project code `table(name).get/list/insert/update/delete`, which run
  hooks, audit and automations, and `raw` Kysely, which skips them.
- **Build and reload.** `adminium build` bundles hooks and actions into `.adminium/build/server/`
  with their npm packages. `adminium dev` rebuilds them on save and the server swaps them in
  without a restart. `adminium check` loads them. The desktop app and `adminium try` never load
  project code.
- **Studio → Settings → Project** (super admins, `GET /api/v1/project/overview`) shows the project
  folder, the loaded hooks and actions, files that did not load, hook errors, and pages changed on
  the server.
- **`@adminium/widgets`:** `PageCrud` takes `bulkActions`, placed between Export and Delete.
- **Automation run origins** gain `hook` and `action`.
