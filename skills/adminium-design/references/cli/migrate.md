<!-- produced from apps/docs/src/content/docs/reference/cli.md § `migrate`; do not edit -->

# CLI reference: `migrate`

```
adminium migrate [--status]
```

Applies any pending `adminium_*` migrations to the meta store, in order. Safe to
re-run: already-applied migrations are skipped via the ledger. `start` and the
setup wizard run this for you; call it directly when you upgrade Adminium in a
deployment that boots against a pre-migrated store.

| Flag | |
|---|---|
| `--status` | List migrations and whether each is applied; apply nothing |
| `--meta-url <dsn>` | Meta store DSN |
| `--data-dir <path>` | Data directory |

```bash
adminium migrate --status
```

```
migration                 applied  note
0001_init                 yes
0007_add_widget_layouts   no
```

The `note` column carries `CHECKSUM DRIFT` (an applied migration no longer
matches this version) or `unknown to this version` (the store was written by a
newer Adminium — you downgraded). Both are alarms:
[Upgrading](https://docs.adminium.dev/self-hosting/upgrades/).

---
