<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § Settings the operator fills in; do not edit -->

# A manifest, task by task: Settings the operator fills in

`settings.json` is the array of values the operator sets on the app's settings page. The app's
screens read them, with their defaults.

```json title="manifest/settings.json"
[
  { "key": "shop_name", "type": "string", "default": "My workshop",
    "label": { "key": "repairs.setting.shopName", "fallback": "Shop name" } },
  { "key": "days_to_repair", "type": "number", "default": 3, "min": 1, "max": 30, "unit": "days" },
  { "key": "open_saturdays", "type": "boolean", "default": false }
]
```

- `type` is `string`, `number`, `boolean`, `enum` (with its `enum` values), `file` or `json`.
  `key` is snake_case.
- A setting's `label` is `{ "key", "fallback" }`, unlike a column's.
- Every setting that is not `"secret": true` is sent to the customer side. Do not put bank details
  or keys here.

Reference: [Settings](https://docs.adminium.dev/reference/manifest/#settings).
