---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
'@adminium/docs': patch
---

**Projects: the docs section.**

- **A new "Projects" section** on docs.adminium.dev: creating a project, the folder and every
  `adminium.config.ts` field, page and schema files with the rules that keep the folder and a
  running server in step, `pull` and `check` (with a CI workflow), hooks and actions, pages and
  widgets, and deploying a project to Docker, Render, Fly.io, App Platform, Railway or a plain VPS.
  The two guides written earlier move from `/guides/projects/` into it.
- **The quickstart is built around `adminium new`**, with `adminium try`, a plain `adminium start`
  and a source checkout as its later sections; the docs home, the intro page, both anatomy pages
  and the self-hosting overview say what a project is and where it fits.
- **The project a `new` writes** links the deploy page from its README, and the in-app Knowledge
  Base's install article no longer describes only Docker and a source checkout (all 8 locales).
- **The CLI reference** gains `adminium try --bridge` and `--log-level`, exit code 78, and the
  pinned-version examples name the release that ships project mode.
- **Two docs gates**, in `docs-contract.test.ts`: the Projects section must be published and fully
  linked in the sidebar, and no page may tell anyone to run the unscoped `npx adminium`, which
  installs an unrelated package.
