<!-- produced from apps/docs/src/content/docs/reference/cli.md § Project files; do not edit -->

# CLI reference: Project files

A project keeps its pages and schema customizations as files, beside
`adminium.config.ts`. This is the short version;
[Page files](https://docs.adminium.dev/projects/page-files/) is the long one:

| File | What it holds |
|---|---|
| `pages/<address>.json` | One page: its template, title, data source, place in the sidebar and settings. The file name is its address, `/p/<address>`. |
| `schema/<database>.json` | One database's customizations: labels, hidden and excluded tables and columns, masks and relations, and who set each. |
| `hooks/<name>.ts` | Code that runs before or after a record is saved. See [Hooks and actions](https://docs.adminium.dev/projects/hooks-and-actions/). |
| `actions/<id>.ts` | A button on records that runs your code. |
| `pages/<address>.tsx` | A page written in React, at `/p/<address>`. See [Pages and widgets](https://docs.adminium.dev/projects/pages-and-widgets/); [`eject`](https://docs.adminium.dev/reference/cli/#eject) turns a page file into one. |
| `widgets/<name>.tsx` | A table cell or dashboard card written in React, which page files use as `project.<name>`. |

Files name a database by its key in `adminium.config.ts` (`"database":
"main"`) and never hold an id from one install, so the same files work on
every machine. Each file's `"$schema"` points at a JSON Schema in the
installed package, so an editor can complete it. Pages that installed add-ons
and apps bring are not written to files.

In [`dev`](https://docs.adminium.dev/reference/cli/#dev) the files are the master copy. On a server they change only
with a deploy: [`start`](https://docs.adminium.dev/reference/cli/#start) applies them, and pages edited in Studio there
are kept until you [`pull`](https://docs.adminium.dev/reference/cli/#pull) them.

---
