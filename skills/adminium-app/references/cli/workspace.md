<!-- produced from apps/docs/src/content/docs/reference/cli.md § `workspace`; do not edit -->

# CLI reference: `workspace`

```
adminium workspace <command> [options]
```

A workspace groups some of this server's databases. `adminium workspace
<command> --help` prints a command's own options.

### `workspace list`

```
adminium workspace list
```

Prints each workspace, its id and name, and the databases it holds. A database
may be in several workspaces, or in none.

### `workspace save`

```
adminium workspace save --workspace <id|name> [--out <file>] [--label <text>]
                        [--answers <file>] [--plan]
```

Saves every database of a workspace as one **workspace file**: one app per
database, each an ordinary app file with its own next version, as
[`app save`](https://docs.adminium.dev/reference/cli/#app-save) makes it. It is the same save as the dashboard's
**Save workspace**, run with host access. A workspace file holds at most eight
apps and 128 MB.

The server settings (the look, languages, wording, system emails) travel with
no app unless the `--answers` file names the database they come from. The
`--answers` JSON file is shaped as `{ "label": …, "instanceFrom": <connection
id>, "apps": [{ "connectionId", "key", "name", "include", "rows", "answers" }] }`;
without `apps`, every database of the workspace is saved, each under the key it
was last saved with, or one made from its name. When an app needs a choice,
nothing is written. `--plan` prints each app's list and writes nothing.

It writes `<workspace>.workspace.tgz` (or `--out`) and prints its fingerprint
and each app's. A workspace file is installed from the dashboard only: **Install
an app → Upload file** reads it and asks, per app, which database it goes on.
See [Workspace files](https://docs.adminium.dev/guides/workspaces/files/).
