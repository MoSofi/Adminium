<!-- produced from apps/docs/src/content/docs/projects/page-files.md; do not edit -->

# Page files

A project keeps its pages and schema customizations as files:

| File | |
|---|---|
| `pages/<address>.json` | One page or dashboard. The file name is its address, `/p/<address>`. |
| `pages/<address>.tsx` | A [page you wrote](https://docs.adminium.dev/projects/pages-and-widgets/) at the same kind of address. |
| `schema/<database>.json` | One database's labels, hidden columns, masks and relations. |

They are written by Adminium and meant to be read and edited by you. Every file
starts with a `$schema` pointing at a JSON Schema inside the installed package,
so an editor completes the fields and marks a mistake before you save.
