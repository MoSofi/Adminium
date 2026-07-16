---
title: Export & restore
description: adminium export-zip bundles the server plus its configuration — not source code. What is in the zip, what is not, and why.
sidebar:
  order: 9
---

```bash
adminium export-zip --out ./adminium-export.zip
```

```
Wrote /work/adminium-export.zip (48.2 KB, 12 entries).
connections: 3 · snapshots: 3 · overrides: 214 · pages: 41 · views: 12 · roles: 4
```

:::danger[This is a server + config bundle. It is not your source code.]
`export-zip` does **not** hand you a generated application. There is no `src/`
directory, no React components, no routes to deploy.

Adminium **interprets configuration at runtime**. It never emits an app — so
there is no generated codebase in it to export, and this is by design rather
than a limitation. What the zip carries is the configuration Adminium
interprets, plus a pin to the `adminium` package version that interprets it.

If you are looking for "download my admin panel's source and maintain it
myself": Adminium does not work that way, on purpose. What you get instead is
portability — the bundle stands the same instance up anywhere Adminium runs.
:::

## What is in the bundle

| | Contents |
|---|---|
| `manifest.json` | Format version, the `adminium` version that wrote it, config-envelope version, secrets policy |
| `README.md` | Says what this is, in its first heading |
| `package.json` | Pins the `adminium` npm package version — the runtime is *named*, not copied |
| `config/settings.json` | Instance settings |
| `config/roles.json`, `config/rolePermissions.json` | RBAC |
| `config/connections.json` | Connection definitions |
| `config/snapshots.json` | Schema snapshots |
| `config/overrides.json` | Your field/label/type customizations |
| `config/pages.json` | Pages and dashboards |
| `config/views.json` | Saved views |

## What is not in it

- **Source code.** See above.
- **The Adminium runtime itself.** `package.json` pins the version; `npm install`
  fetches it. The bundle carries a reference, not a copy.
- **Your rows.** No table data, ever. This is configuration.
- **Your secrets** — unless you ask. Default is omitted.

## Secrets are omitted by default

An export is shareable by default. DSN passwords and provider API keys are left
out, and the target re-enters them on import.

```bash
adminium export-zip --include-secrets --out ./full.zip
```

```
Wrote /work/full.zip (49.1 KB, 12 entries).
This bundle contains encrypted secrets — treat it as sensitive.
```

The manifest records which policy applied — `omitted` or `encrypted` — so a
bundle can never be mistaken for something it is not.

:::caution[`--include-secrets` is not "the secrets travel"]
It means **ciphertext** travels. Those values are encrypted under a key derived
from `ADMINIUM_SECRET`, so only an instance with the **same** `ADMINIUM_SECRET`
can read them. Move the bundle to an instance with a different secret and the
values are inert.

That makes `--include-secrets` useful for moving an instance you control, and
useless as a way to hand someone else a working credential. Which is the correct
behavior — but it also means the bundle is exactly as sensitive as your meta
store, and should be handled that way.
:::

## Restoring

```bash
adminium import-zip --in adminium-export.zip
```

The bundle carries a manifest with the config-envelope version, so a bundle
written by an older Adminium replays forward into a newer one. Resources are
matched on natural keys rather than raw ids, so a re-import updates what is
already there instead of duplicating it.

Trial it first — `--dry-run` validates the whole bundle and prints what would be
written, without touching the database:

```bash
adminium import-zip --in adminium-export.zip --dry-run
```

If secrets were omitted, connections that are new to the target import without
credentials and you re-enter them once. Connections the target already has keep
the credentials they have.

→ [`import-zip` reference](/reference/cli/#import-zip)

## Export is not backup

Worth being blunt about, because the file extension invites the assumption:

| | `export-zip` | A real backup |
|---|---|---|
| Connection config, pages, roles, views | Yes | Yes |
| Your database's rows | **No** | Yes |
| The audit log | **No** | Yes |
| Jobs, sessions, run history | **No** | Yes |
| Point-in-time recovery | **No** | Yes |

`export-zip` is for **portability** — moving an instance, replaying a
configuration, putting your admin-panel config in source control, handing a
colleague a reproducible setup.

For backup, back up the meta store with your database's own tooling, and back up
`ADMINIUM_SECRET` alongside it. See
[Self-hosting → Backups](/self-hosting/#backups).

## Exporting one connection

```bash
adminium export-zip --connection <id> --out ./one-connection.zip
```

Restricts the bundle to that connection's configuration. Without it, the whole
instance is exported.

## Flags

| Flag | Default | |
|---|---|---|
| `--connection`, `-c` | the whole instance | Export only this connection |
| `--out`, `-o` | `./adminium-export.zip` | Destination path |
| `--include-secrets` | off | Include encrypted DSNs and provider keys |
| `--data-dir` | `ADMINIUM_DATA_DIR` | Data directory |
| `--meta-url` | `ADMINIUM_META_URL` | Meta store DSN |

Full reference: [`adminium export-zip`](/reference/cli/#export-zip).
