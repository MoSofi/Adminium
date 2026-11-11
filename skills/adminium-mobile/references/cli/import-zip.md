<!-- produced from apps/docs/src/content/docs/reference/cli.md § `import-zip`; do not edit -->

# CLI reference: `import-zip`

```
adminium import-zip <file> [--dry-run] [--owner <email>] [--password-stdin] [--local-owner] [--json]
```

Restores a bundle produced by [`export-zip`](https://docs.adminium.dev/reference/cli/#export-zip) — the other half of the
same flow. The meta-store migrations run first, then every config document is
replayed forward to the version this build understands, so a bundle exported by
an older Adminium imports cleanly.

Resources are matched on natural keys rather than raw ids, so a re-import updates
what is already there instead of duplicating it. Everything happens in one
transaction: a bundle that fails halfway leaves no half-restored instance behind.

| Flag | Default | |
|---|---|---|
| `<file>`, or `-i`, `--in <file>` | **required** | Bundle to import |
| `--dry-run` | off | Validate and report; write nothing |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN |
| `--project-dir <folder>` | `ADMINIUM_PROJECT_DIR` | Where an export file's project folder goes |
| `--owner <email>` | the only Super Admin | Export file: who gets a new password. Required without a terminal when the file holds more than one |
| `--password-stdin` | off | Export file: read that password from the first line of standard input |
| `--local-owner` | off | Export file: `--owner` is also this computer's owner, whom the desktop app signs in without a password |
| `--json` | off | Export file: say the outcome, or the refusal, as one line of JSON |

`import-zip` also reads the **Export everything** file (from Studio, or
`adminium archive create --export`) into a fresh instance. The file carries no
passwords, so the import gives one Super Admin a new one: asked twice in a
terminal, or read with `--password-stdin`. Everyone else signs in through a
password reset; connection strings, mail and AI keys are entered again. See
[Export everything from Studio](https://docs.adminium.dev/self-hosting/export-everything/).

With `--json` an export file's import prints one line of JSON instead of
sentences: with `--dry-run`, what the file holds and its Super Admins (so an app
can ask who signs in first); after an import, who was given the password; on a
refusal, `{"ok":false,"refused":…}`, where `full-archive` means the file is a
whole-server archive for [`archive restore`](https://docs.adminium.dev/reference/cli/#archive). The desktop app's
**File → Open a project…** runs it this way.

An export never says who a desktop app signs in without a password: that is
`--local-owner`'s to say, on the computer that imports it. When the file carries
a project folder, the import writes the `.env` its config reads, as `new` does:
each project database's variable (`DATABASE_URL`, …) set to the SQLite file it
restored, or empty when the connection string must be entered again, and the
names `.env.example` lists, empty. Nothing of the original `.env` travels.

Trial a restore before committing to it:

```bash
adminium import-zip adminium-export.zip --dry-run
```

That reads the archive, checks the manifest, replays and validates every config
document, and prints what *would* be written — without touching the database.

> **Note: A bundle from a newer Adminium is refused**
> Not partially read. A build that does not understand a document's version would
> silently drop the parts it cannot see, and a silent partial restore is worse than
> a failed one. Upgrade this instance instead.

If the bundle was exported without `--include-secrets` (the default), connections
that are **new** to this instance import without credentials and need their
connection string entered once. Connections already configured here keep the
credentials they have — a no-secrets bundle has nothing to replace them with, so
it does not try.

→ [Export & restore](https://docs.adminium.dev/self-hosting/export-zip/)

---
