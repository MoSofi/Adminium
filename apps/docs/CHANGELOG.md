# @adminium/docs

## 0.3.0-rc.1

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
