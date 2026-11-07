<!-- produced from apps/docs/src/content/docs/reference/manifest.md § A self-made app — A page's envelope and its views; do not edit -->

# Manifest spec: A self-made app — A page's envelope and its views

### A page's envelope and its views

A page a person changed by hand cannot be made again by the generator, so a self-made app carries
it whole:

| Field | Rule |
|---|---|
| `envelope` | `{ "v", "kind", "template", "config", "padding"?, "width"? }`: the page as the dashboard stores it, without its id, source, access or address. `template` must be the page's own `template`, and a page with an envelope has no `config` beside it. |
| `views` | 1–24 shared views, each `{ "v", "kind", "name", "isDefault"?, "config" }`: `kind` is `filters` (a list's saved state) or `layout` (a dashboard's arrangement), `name` is 1–120 characters and unique per kind, and each kind has at most one default. |

The install makes the page the target's own: it gives it a new id, source, access and address,
finds its tables through the app's refs (a table named any other way is refused), reads its column
facts from the target's database, and stamps it as untouched, so a later update may replace it
until someone edits it. Views are written as shared views. A page nobody changed travels without
an envelope, as an ordinary page entry.
