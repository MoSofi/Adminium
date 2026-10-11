<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Frontends; do not edit -->

# Manifest spec: Frontends

`frontends` declares the app's own screens: a **staff** side, a **customer** side, a **mobile**
side (a phone app), or any of them together. At least one is required, and each side may appear
once. The Adminium dashboard itself is always
there and is not declared.

```json
"frontends": [
  { "side": "staff", "kind": "spa", "entry": "index.html",
    "routes": { "pos": "/" }, "placement": "external" },
  { "side": "customer", "kind": "spa", "entry": "index.html",
    "routes": { "book": "/", "manage": "/manage" } }
]
```

| Field | Required | Rule |
|---|---|---|
| `side` | yes | `staff`, `customer` or `mobile`. |
| `kind` | yes | `spa`, `electron` or `none`; `expo` for the `mobile` side, and for it alone. |
| `entry` | no | The frontend's entry file (`index.html`). |
| `env` | no | The environment variables the frontend reads, each `{ "required": boolean, "example"?: string }`. |
| `routes` | no | The views this side owns, from a view name to a path. |
| `placement` | no | Staff side only: `internal` opens the screens inside the dashboard, `external` on their own address (a till). The operator can change it. Absent means `internal`. |
| `enabled` | no | Whether the side starts switched on. Absent means on. |

A `mobile` side is `{ "side": "mobile", "kind": "expo" }` and nothing more: it is a phone app in
`apps/<key>/mobile/`, which Adminium serves to nobody and no package carries, so it has no entry,
routes, placement or switch. What it has is a key of its own kind for the public API, made at
install beside the customer key: see [A phone app for an app](https://docs.adminium.dev/guides/apps/phone-app/). A
manifest with a `mobile` side needs the Adminium that knows it or a newer one
(`compatibility.minAdminiumVersion`); an older one refuses the whole manifest.

Adminium serves each web side at `/apps/<key>/<side>/`. The staff side needs a signed-in user; the
customer side is public and calls the [public API](https://docs.adminium.dev/guides/public-api/endpoints-and-keys/) with the
app's `customer` browser key, which the install creates. A staff side can be handed a second key
for a screen of its own; see [publicKeys](https://docs.adminium.dev/reference/manifest/#publickeys). Each side reads its `surface-config.json` at boot: the real table
names, the app's settings and, for the staff side, the connection, the venue's time zone and
currency, who is signed in, and `access`: which of `read`, `create`, `update` and `delete` they
hold on each of the app's tables, and the app's roles they hold. A staff screen uses it to leave
out a button whose write would be refused; the data API still checks every write.
