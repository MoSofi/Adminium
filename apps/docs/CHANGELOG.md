# @adminium/docs

## 0.3.0-rc.0

### Patch Changes

- c451e7d: **A page assistant that drafts in the page's own format, and never saves.**
  
  The pages that build documents — Email templates and Report builder — gain an
  **Ask** button in the header. It opens an assistant
  that already knows what that page holds: its documents, the format they are
  written in, your branding, and the tables your role can read. Describe what you
  need and it drafts it, showing its work: every tool it ran, every table it
  touched, and what the draft would be.
  
  **It never writes.** The model's last move is a draft. Every button that would
  change something is locked until you turn actions on for that session, needs the
  same permission the page's own Save needs, and asks once more before it runs.
  What it saves is a draft — an email template disabled, a report with status
  `draft` — and every write leaves an audit row naming the session that proposed
  it.
  
  **Reading rows is opt-in.** By default it works from your documents and schema
  alone. An administrator can let it read rows your role can read — masked, at
  most 50 per request, and listed under *Sources read* on every result. That
  switch is not carried by an exported bundle: importing somebody else's
  configuration can never turn it on for you.
  
  The permission is seeded to Super Admin and Admin only, and a role that may
  draft but not save is the ordinary case: it can look, draft, preview, and put a
  draft straight onto an editor's screen, with the writing buttons locked and a
  sentence saying why.
  
  Settings → AI names the assistant and holds the row-data switch. It needs the
  same AI provider schema enrichment uses; there is no copy-paste path here,
  because a conversation is many round trips.

## 0.2.12

## 0.2.11

## 0.2.10

### Patch Changes

- 1923ca6: **The decisions behind the architecture become public docs.**
  
  - **A new "Decisions" section** under Anatomy on docs.adminium.dev, with one short page per
    decision that is load-bearing across the codebase: pages are settings rather than generated
    code, one process with no Redis, the three connections and where the meta store lives, the
    add-on trust model, one version for every package, tokens only with no `style` props, the i18n
    rules, the LLM never writing on its own, project code being trusted, and one npm package. Each
    covers the situation the decision was made in, the decision, and what it means for a
    contributor — including what it costs, where it costs something.
  - **The comment rule that follows from it**, on the section's landing page: a comment says what
    the code does and why, and leaves the history to git and to these pages.
  - **Two stale counts fixed.** The anatomy pages said "twenty workspaces" and "fifteen packages";
    there are twenty-one and sixteen.
  - **A docs gate**, in `docs-contract.test.ts`: every page in the section must be linked from both
    the sidebar and the section's index, derived from the filesystem so a new page that nothing
    links is what goes red.
- d95d39f: **Projects: the docs section.**
  
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
- 8b73f80: **The packages page documents `public-client`, the one package it was missing.**
  
  - **A new `@adminium/public-client` section** in [The packages, one by
    one](https://docs.adminium.dev/anatomy/packages/), placed at the end of the leaf block: the
    typed client for the scoped `/api/v1/public` surface, why it carries zero dependencies when it
    ships inside fifteen static SPAs, why `createPublicClient` returns `null` rather than throwing
    when a build has no server, the thirteen error codes and which one the client mints itself, the
    two refusals that are blunt on purpose, and the tenant-time and tenant-money helpers that exist
    because the obvious conversion reads the visitor's clock.
  - **What keeps it in its lane, given that no dependency rule names it** — nothing in the
    repository imports it, it is the only package passing a `functions` coverage floor, and its
    published identity (`@adminiumjs/public-client`) is not its source name.
  - **The page covered fifteen of the sixteen packages it claimed.** It now covers sixteen, with a
    summary-table row to match, and the snapshot date says which row was measured later.
- c0096c0: **A fresh clone runs the admin panel in three commands.**
  
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

## 0.2.9

## 0.2.8

## 0.2.7

## 0.2.6

## 0.2.5

## 0.2.4

### Patch Changes

- a44a0ff: The ghcr image and the desktop build now carry the six first-party add-ons as
  a pre-verified bundled set.
  
  The boot seed has existed since the store landed, but nothing ever put a bundle
  where it looks — every image and installer shipped an empty Add-ons page and
  called the air-gap story done. Now a release script
  (`scripts/release/fetch-add-ons-bundle.mjs`) downloads the six tarballs at build
  time against exact version + sha512 pins (`scripts/release/add-ons-bundle.json`,
  copied from the release ledger — never `latest`, no redirects, timing-safe
  digest comparison, refusal on any unpinnable entry), and writes the flat
  `<key>-<version>.tgz` + `.tgz.integrity` layout the seed reads. The Docker build
  parks it at `/app/add-ons-bundle`, which the runtime stage's CWD makes the
  server's own default; desktop-release.yml parks it in `resources/add-ons-bundle`
  next to the demo seed.
  
  The desktop shell now closes the loop in both directions: `buildServerEnv`
  points `ADMINIUM_BUNDLED_ADD_ONS` at the packaged directory (only when it
  actually exists — dev checkouts ship no bundle), and the variable joins
  `STRIPPED_INHERITED_ENV_KEYS`, because it names a directory the server installs
  packages FROM, hashes and all — an inherited value was a whole package set
  chosen by whoever can set an environment variable.
  
  Seeding stays copy-if-absent with every hash re-verified on the way in, so the
  build-time verification is the first check, not the only one. A new
  self-hosting docs page (Installing add-ons) states the rest of the story
  plainly: the bundled set browses with zero network, the online catalog is a
  default-off opt-in that contacts exactly two hosts and discloses the
  deployment's IP and exact package@version to npm, and air-gapped installs
  sideload with a hash from the release ledger.

## 0.2.3

## 0.2.2

### Patch Changes

- docs: correct four claims the code does not support
  
  - **Desktop.** `Settings → Desktop` renders exactly three cards (Sign-in,
    Share on local network, App permissions). The install page's update-mode
    table and the backups page's "change the depth or turn it off in Settings →
    Desktop" both pointed at controls that have never existed. Both settings are
    real — `updates.mode` and `autoBackup.{enabled,keep}` in `config.json` — so
    the pages now say where they actually live, that the file is read once at
    launch, and which read-only surfaces (Help → About, Help → Check for
    Updates…) exist instead. Also records how the updater resolves its release
    (the releases list, filtered to `desktop-v*`, never GitHub's repository-wide
    "latest" pointer), the auto-backup schedule, and that `export-zip` is
    portability rather than a backup.
  - **`anatomy/index.md`.** "Nothing in the repository sends mail" was false end to
    end: `email.smtp` drives a real nodemailer transport, `email.send` is a
    registered job kind, and password resets, invitations, notifications and the
    template test-send all queue through it. Rewritten to name the absences that are
    real — no provider adapters, no `/settings/email` screen, no outbox table — and
    to correct `smtpConfigured` from "the whole of it" to the read-only consequence
    it is.
  - **`anatomy/packages.md`.** Every row of the per-package table recomputed
    under the convention the page states; 13 of 15 were wrong, several by a whole
    package's worth of files. The page now prints the commands that produce the
    figures and says plainly that nothing in CI holds them.
  - **The axe baseline count.** Dropped rather than refreshed. It is a debt
    counter with no CI tie — the quoted 162 had drifted well past the file — so
    the note points at `packages/ui/a11y-baseline.json` instead.

## 0.2.1

## 0.2.0

## 0.1.0

---

*A note on the entries above.* Some of them cited the internal work plan this
repository was built from — a document filename, a section, or a task id. That
plan was never published, so those citations were dead ends for every reader but
their author, and they were reworded on 2026-09-17. No entry's substance
changed: only the references went. The reasoning they pointed at is public now,
one short page per decision, at
<https://docs.adminium.dev/anatomy/decisions/>.
