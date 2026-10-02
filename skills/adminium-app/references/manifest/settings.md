<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Settings; do not edit -->

# Manifest spec: Settings

`settings` declares values the operator sets for the app, such as a business type or a currency.
They appear on the app's settings page, and the app reads them, with their defaults, from
`surface-config.json`.

```json
{ "key": "business_type", "type": "enum", "enum": ["restaurant", "retail"], "default": "restaurant",
  "label": { "key": "mft.pos.setting.businessType", "fallback": "Business type" } }
```

Every setting has a snake_case `key`, a `type`, and optionally `required`, `secret`, a `label` and
a `help` sentence shown under the field (both i18n messages). By type:

| `type` | Extra fields |
|---|---|
| `string` | `default` (string) |
| `number` | `default`, `min`, `max` (numbers), `unit` (up to 20 characters) |
| `boolean` | `default` (boolean) |
| `enum` | `enum` (at least one value, required), `default` (string) |
| `file` | `accept` (a list of accepted types) |
| `json` | `default` (any JSON) |

A setting marked `secret` is never sent to an app's screens. In this release an app's settings page
does not show or store secret settings; they are used by add-ons.
