<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Identity; do not edit -->

# Manifest spec: Identity

| Field | Required | Rule |
|---|---|---|
| `manifestVersion` | yes | Always `1`. |
| `kind` | no | `"app"` or `"add-on"`. A manifest with no `kind` is read as an app. |
| `key` | yes | `^[a-z][a-z0-9-]{1,79}$`, so 2–80 characters. Apps and add-ons share one key namespace. `apps`, `add-on`, `add-ons`, `dashboard`, `demo`, `index` and `search` are reserved. |
| `name` | yes | Display name, 1–80 characters. |
| `version` | yes | Strict semver. |
| `publisher` | yes | `{ id, name, url? }`. `id` matches `^[a-z][a-z0-9-]{1,39}$`, `name` is 1–80 characters, `url` is an optional URL of up to 200 characters. |
| `license` | yes | An SPDX identifier for the package's own code, 1–80 characters. It is informational. |
| `description` | yes | An i18n message, shown on the app's card. |
| `categories` | yes | At least one. For an app: `commerce`, `hospitality`, `operations`, `crm`, `internal-tools`. Add-ons have their own list; see [Add-on manifests](https://docs.adminium.dev/reference/manifest/#add-on-manifests). |
| `capabilities` | no | What the package uses; see [Capabilities](https://docs.adminium.dev/reference/manifest/#capabilities). |

> **Caution: Two publishers only**
> Adminium accepts `"publisher": { "id": "adminium", … }`, and for an app, `"id": "local"`: an app
> made on the install it runs on, which installs from a file and never from a catalogue. See
> [An app in your project](https://docs.adminium.dev/projects/apps/#an-app-you-made-yourself). A manifest from any other
> publisher is refused at validation, and an add-on can never be `local`.
