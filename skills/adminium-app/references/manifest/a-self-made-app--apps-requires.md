<!-- produced from apps/docs/src/content/docs/reference/manifest.md § A self-made app — `apps.requires`; do not edit -->

# Manifest spec: A self-made app — `apps.requires`

### `apps.requires`

The other apps this app needs on its database: a dashboard saved with pages on a released app's
tables names that app here rather than carrying it.

```json
"apps": {
  "requires": [{ "publisher": "adminium", "key": "point-of-sale", "range": ">=1.2.0",
                 "tables": ["orders", "order_lines"] }]
}
```

| Field | Required | Rule |
|---|---|---|
| `publisher` | yes | The required app's publisher id. Never `local`: `local` says where a file was made, not which app it is. |
| `key` | yes | The required app's key. Not this app's own, and named once. |
| `range` | no | A semver range (`>=1.1.0`, `^1.1.0`). Any version when absent. |
| `tables` | no | 1–64 of this app's own table refs that are the required app's tables. Each is named by one requirement at most. |

At most 8 requirements. The install needs each app already installed **on the same database**, by
the same publisher, at a version in `range` (`REQUIRED_APP_MISSING`, `REQUIRED_APP_PUBLISHER`,
`REQUIRED_APP_VERSION`, `REQUIRED_APP_TABLE`). It creates none of the `tables`: it uses the
required app's and records that it does, so uninstalling the required app is refused while this one
is installed there (`APP_REQUIRED_BY`).
