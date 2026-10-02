<!-- produced from apps/docs/src/content/docs/projects/apps.md § The manifest, as parts; do not edit -->

# An app in your project: The manifest, as parts

The [manifest](https://docs.adminium.dev/reference/manifest/) is the one document that says what the app is. In an app
folder you may write it as a single `manifest.json`, exactly as the reference shows it, or as a
`manifest/` folder of smaller files. Adminium puts the parts together into the same document before
it does anything with them, so nothing about the manifest itself changes — only where each field
is written:

| File in `manifest/` | Holds |
|---|---|
| `app.json` | `manifestVersion`, `key`, `name`, `version`, `publisher`, `license`, `description`, `categories`, `compatibility`, `capabilities`, `frontends`, `navGroups`, `widgets`, and `prefixed` (the manifest's `requiredSchema.prefixed`) |
| `tables/<ref>.json` | One table of `requiredSchema.tables`. The file is named after the table's `ref` |
| `pages/<ref>.json` | One page of `pages`. The file is named after the page's `ref` |
| `roles.json` | `roles`, as the array |
| `access.json` | An object with `publicAccess` and, when the app has them, `publicKeys` |
| `emails.json` | An object with `outbox` and `emailTemplates` |
| `add-ons.json` | `addOns`, as the object |
| `sample.json` | An object with `sampleData` and, when used, `seeds` |
| `settings.json` | `settings`, as the array |
| `option-lists.json` | `optionLists`, as the object |
| `documents.json` | `documents`, as the array |

Only `app.json`, one table and one page are required. A part you do not need is simply not there.
A file that is none of these is an error, so a misspelt name cannot be silently left out, and
keeping both `manifest.json` and `manifest/` is an error too.
