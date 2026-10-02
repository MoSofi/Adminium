<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests; do not edit -->

# Manifest spec: Add-on manifests

An add-on manifest has `"kind": "add-on"` and shares the identity fields, `compatibility`,
`capabilities`, `settings`, `widgets` and `requiredSchema` with an app. It differs in these ways:

- **Categories** come from a separate list: `artwork`, `delivery`, `payments`, `email`, `data`.
- **No `pages`, `roles`, `frontends`**, and none of `navGroups`, `optionLists`, `publicAccess`,
  `publicKeys`, `outbox`, `emailTemplates`, `sampleData`, `seeds`, `addOns` or `documents`. An
  add-on's own screens are code it ships, declared under `addOn.pages`.
- **`requiredSchema` is optional** and cannot be `prefixed`: an add-on uses its host app's
  tables. Tables an add-on creates are kept when it is disconnected.
- **An `addOn` block** is required:

| Field | Required | Rule |
|---|---|---|
| `attaches` | yes | At least one `{ "app", "range"?, "table"? }`: an app key, or `"*"` when the add-on is not specific to one app. `range` is `1.2.3`, `^1.2.3`, `~1.2.3` or `*`. `table` is only for the record editor panel slot. |
| `connect` | yes | `{ "kind" }`, with `kind` one of `none`, `api-key`, `oauth2`. `oauth2` needs `authorizeUrl`, `tokenUrl` and the `oauth-connect` capability; `scopes` is optional. |
| `provides` | no | Contracts the add-on implements: `{ "contract", "version", "server" }`. |
| `consumes` | no | Contracts it uses: `{ "contract", "version" }`. |
| `slots` | no | Places in the host's screens it fills: `{ "slot", "client", "order" }`. |
| `events` | no | Events it handles: `{ "on", "server" }`. |
| `scopes` | no | What it may reach, such as `records:<table>:write`. A `records:` scope must name a table of the host app or of the add-on. |
| `network` | no | `{ "allow": [hostnames] }`: the exact HTTPS hosts its server code may call. Required, and non-empty, with the `outbound-http` capability. No wildcards, IP addresses or ports. |
| `publicSettings` | no | The setting keys its browser code may read. Never a `secret` setting. |
| `demoTransport` | no | The module that stands in for the real third-party service in a demo. |
| `pages` | no | Dashboard pages it renders from its own bundle: `{ "ref", "title", "icon", "client", "nav"?, "detail"? }`, served at `/add-ons/<key>/<ref>`. Needs `hostApi`. |
| `navGroups` | no | Sidebar groups for those pages: `{ "key", "label", "order" }`. A group may not reuse a built-in key (`workspace`, `library`, `planning`, `people`, `account`), and every declared group must be used by a page. |
| `hostApi` | with `pages` | The version of the host API its pages are built against: `1`. |
| `shapes` | no | 1–8 shapes apps build their tables on. See below. |

Contract ids and slot ids come from closed registries in the add-on contracts package. How
Adminium runs add-on code, and why only first-party add-ons are accepted, is explained in
[Add-on trust](https://docs.adminium.dev/anatomy/decisions/add-on-trust/).

### Shapes

A shape is what an app's tables are [built on](https://docs.adminium.dev/reference/manifest/#tables-built-on-an-add-ons-shape): named parts, each
with its columns, rules and states, the document profiles made for an app's tables, and the
messages an app built on it sends.

| Field | Required | Rule |
|---|---|---|
| `name` | yes | kebab-case. An app names the shape `<add-on key>/<name>@<version>`. |
| `version` | yes | 1–99. A change an app's tables cannot follow is a new version. |
| `parts` | yes | At least one, keyed by a snake_case part name: `{ "columns", "states"? }`, with 1–60 [columns](https://docs.adminium.dev/reference/manifest/#columns) and optional [states](https://docs.adminium.dev/reference/manifest/#states). |
| `documentProfiles` | no | Up to 8 [documents](https://docs.adminium.dev/reference/manifest/#documents), each naming the `part` it is drawn for instead of a `table`, with no `addOn` and no `feature`. |
| `outbox` | no | `{ "producers", "templates"? }`: 1–16 [producers](https://docs.adminium.dev/reference/manifest/#outbox), whose tables are the shape's parts, and up to 16 templates, each an [email template](https://docs.adminium.dev/reference/manifest/#emailtemplates) with a `kind` (the producer's) instead of a `key`. |

A part is checked the way an app's tables are, with the parts of all the add-on's shapes as the
tables. A column's `references` names another part of the same shape (`"document"`), or a part of
another of the add-on's shapes (`"quote@1/document"`). A rule in a part that reads a setting reads
one of the add-on's own (`{ "addOn": "<its key>", "setting" }`), since the add-on cannot know an
app's settings row.
