<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests; do not edit -->

# Manifest spec: Add-on manifests

An add-on manifest has `"kind": "add-on"` and shares the identity fields, `compatibility`,
`capabilities`, `settings`, `widgets` and `requiredSchema` with an app. It differs in these ways:

- **Categories** come from a separate list: `artwork`, `delivery`, `payments`, `email`, `data`.
- **No `frontends`**, no `addOns.requires` and no `addOns.features`: an add-on has no screens
  outside the dashboard and never requires another add-on (it may `suggests` one).
- **An add-on that keeps tables of its own** sets `compatibility.minAdminiumVersion` to `0.3.18`
  or later and `requiredSchema.prefixed` to `true`. It may then declare, in an app's words,
  `pages`, `navGroups`, `roles`, `optionLists`, `documents`, `seeds`, `outbox`, `emailTemplates`,
  `sampleData`, `publicAccess` and `publicKeys`. See
  [below](https://docs.adminium.dev/reference/manifest/#an-add-on-with-tables-of-its-own). An add-on released before that floor declares none
  of them and installs exactly as it always did: it uses its host app's tables, or creates
  unprefixed ones that are kept when it is disconnected.
- **A page's `ref` starts with the add-on's key** (`stock-kit-items`), so no two add-ons, and no
  add-on and app, can declare the same page.
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
| `hostApi` | with `pages` | The version of the host API its pages are built against: `1`, or `2` for a page that reads the [data kit](https://docs.adminium.dev/guides/add-ons-with-tables/#the-data-kit). `2` needs `compatibility.minAdminiumVersion` `0.3.18` or later. |
| `words` | no | 1–4 questions asked of a ledger with nothing written. See [Stock words](https://docs.adminium.dev/reference/manifest/#stock-words). |
| `recordTabs` | no | 1–6 tabs of its rows shown on another table's record. See [A tab on another table's record](https://docs.adminium.dev/reference/manifest/#a-tab-on-another-tables-record). |
| `shapes` | no | 1–8 shapes apps build their tables on. See below. |

Contract ids and slot ids come from closed registries in the add-on contracts package. How
Adminium runs add-on code, and why only first-party add-ons are accepted, is explained in
[Add-on trust](https://docs.adminium.dev/anatomy/decisions/add-on-trust/).
