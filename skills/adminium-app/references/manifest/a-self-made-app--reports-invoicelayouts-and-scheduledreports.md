<!-- produced from apps/docs/src/content/docs/reference/manifest.md § A self-made app — `reports`, `invoiceLayouts` and `scheduledReports`; do not edit -->

# Manifest spec: A self-made app — `reports`, `invoiceLayouts` and `scheduledReports`

### `reports`, `invoiceLayouts` and `scheduledReports`

What the report builder and the invoice editor made, and reports sent on a schedule. Up to 32 of
each, each with a kebab-case `key` (up to 80 characters) unique in its block and a `name` (1–120).

| Block | Each entry |
|---|---|
| `reports` | `kind` (`report`, the default, or `template`), `status` (`draft`, `sent`, `live`), and `body`: the builder's document as it stores it, at most 4 MiB. |
| `invoiceLayouts` | `topic` (`recurring`, `services`, `receipts`, `sales`, `logistics`, `other`), `lang` (`en`, `de`, `fr`, `es`, `pt`, `ja`), and `body`, at most 4 MiB. A design, never an issued invoice. |
| `scheduledReports` | `page` (one of the app's page refs), `schedule` (`{ "frequency": "daily" \| "weekly" \| "monthly", "dayOfWeek"?, "dayOfMonth"?, "time": "08:00" }`; a weekly one names its day, 0 = Sunday, and a monthly one its day of the month), and `format` (`pdf`, `png`). |

Who receives a scheduled report never travels: it arrives switched off with nobody on it, for the
owner to choose.
