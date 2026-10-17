<!-- produced from apps/docs/src/content/docs/reference/cli.md § `import-zip`; do not edit -->

# CLI reference: `import-zip`

```
adminium import-zip --in <file> [--dry-run]
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
| `-i`, `--in <file>` | **required** | Bundle to import |
| `--dry-run` | off | Validate and report; write nothing |
| `--data-dir <path>` | | Data directory |
| `--meta-url <dsn>` | | Meta store DSN |

Trial a restore before committing to it:

```bash
adminium import-zip --in adminium-export.zip --dry-run
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
