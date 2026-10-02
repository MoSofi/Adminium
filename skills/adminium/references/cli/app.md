<!-- produced from apps/docs/src/content/docs/reference/cli.md § `app`; do not edit -->

# CLI reference: `app`

```
adminium app <command> [key] [options]
```

Works on an app in this project's `apps/<key>/` folder — see
[An app in your project](https://docs.adminium.dev/projects/apps/). `[key]` may be left out when the
project holds one app. `adminium app <command> --help` prints a command's own
options.

### `app new`

```
adminium app new <key> [--name <text>] [--staff] [--customer] [--no-install]
```

Writes a small working app into `apps/<key>/`: two tables, a dashboard page for
each, one role and sample data, with its manifest as part files, a README and a
test file (`node --test apps/<key>/tests/app.test.mjs`). The app carries the publisher `local`. It then runs the same check as
`app check`.

| Flag | Description |
|---|---|
| `--name <text>` | The app's name as people read it. Default: made from the key |
| `--staff` | Add screens for staff in `apps/<key>/staff/` |
| `--customer` | Add public screens for customers in `apps/<key>/customer/`, and an `access.json` that grants them one table |
| `--no-install` | Do not install the packages the screens need |

With a side, `react` and `react-dom` (and `@adminiumjs/public-client` for a
customer side) are added to the project's `package.json` when they are not
there, and the project's package manager installs them. With neither flag the
app is its tables and pages alone, and nothing is installed.

### `app check`

```
adminium app check [key] [--json] [--split]
```

Puts the app's manifest together — one `manifest.json`, or the part files in
`manifest/` — and validates it exactly as an install does, naming the file and
field of each problem. It also checks that the app runs on this Adminium, that
every side the manifest declares has its code in `apps/<key>/<side>/src/`, and
that the sample data fits the app's tables. It ends by listing, table by table,
what the customer side may reach. It needs no database and exits `2` when
something is wrong.

| Flag | Description |
|---|---|
| `--json` | Print the result as JSON: `ok`, the problems with their file and field, and the public access |
| `--split` | Rewrite a single `manifest.json` as a `manifest/` folder of parts. Nothing is written unless the parts compose back to the same manifest |

### `app build`

```
adminium app build [key]
```

Checks the app, then bundles each side in `apps/<key>/<side>/src/`, entered at
`main.tsx`, into `.adminium/build/apps/<key>/<side>/`: an `index.html`, the
script and stylesheet under `assets/` with a hash in their names, files from
the side's `public/` folder as they are, and `surface.json` when the side has a
`nav.json`. It needs the `esbuild` dev dependency and the project's packages
installed. An app with no screens of its own builds nothing.

### `app try`

```
adminium app try [key] [--add-ons <dir>] [--keep] [--json]
```

Packs the app, then proves the package installs and is served. It starts a
fresh Adminium in a temp folder, with an empty SQLite database and nothing
listening on a port, and does what a person does in Studio through the same
routes: uploads the package with its fingerprint, checks the tables, installs,
and adds the sample data. It then:

- reports any page the install had to create empty, because its table cannot
  back its template;
- opens each side and every file its page names;
- reads the app's first table as the signed-in person, and checks the staff
  side is refused to someone who is not signed in;
- asks the public API, with the browser key the customer side is served, for
  each table `access.json` grants to read, and sends an empty row to each it
  grants to add to (which must be refused for its values, not for access);
  then for the tables it does not grant, for a table outside the app, and
  without the key — each of which must be refused.

It prints one line per step and exits `2` when a step fails, with the server's
own words for a refusal. Nothing in your project or its database is changed.
It does not run the screens in a browser, send an email, draw a document or
move a row through its states: open each screen once after installing.

This is `adminium app try`. Plain [`adminium try`](https://docs.adminium.dev/reference/cli/#try) is another command:
the setup wizard for running Adminium without a project.

| Flag | Description |
|---|---|
| `--add-ons <dir>` | A folder of add-on packages (`<key>-<version>.tgz`, each with its `.tgz.integrity`) for an app that requires one |
| `--keep` | Keep the throwaway Adminium's folder, and print where it is |
| `--json` | Print the steps as JSON |

### `app pack`

```
adminium app pack [key] [--out <dir>]
```

Checks the app, builds its sides, and writes `<key>-<version>.tgz` with its
fingerprint in `<key>-<version>.tgz.integrity`, in `.adminium/packs/` unless
`--out` says otherwise. The package holds the manifest as one `manifest.json`,
each built side, and `seeds/`. Packing the same files twice gives the same
bytes. A link or a hidden file in `seeds/` is refused, and so is a package
larger than an upload takes (32 MB). The project's hooks and actions are not
part of an app package.

Install the file from **Studio → Hosted apps → Install an app**: upload it and
paste the fingerprint. See [Installing apps](https://docs.adminium.dev/self-hosting/installing-apps/).
