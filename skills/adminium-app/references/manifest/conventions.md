<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Conventions; do not edit -->

# Manifest spec: Conventions

Several shapes recur throughout the format.

| Shape | Rule |
|---|---|
| **i18n message** | `{ "key": "...", "fallback": "..." }`. `key` is a catalogue key (1–120 characters); `fallback` is the English text shown when the key is not in the catalogue (1–400 characters). Both are required and nothing else is allowed. |
| **Label** | Either a plain string (1–256 characters), or an object keyed by BCP 47 tag, such as `{ "en-US": "Category", "de-DE": "Kategorie" }`. A keyed label must include `en-US`, which every reader falls back to. Each value is 1–120 characters. |
| **snake_case ref** | `^[a-z][a-z0-9_]*$`. Used for table refs, column refs and setting keys. |
| **kebab-case key** | `^[a-z][a-z0-9-]*$`. Used for page refs, role keys, nav group keys and option list names. |
| **Version** | Strict semver: `major.minor.patch`, with an optional pre-release and build part (`1.2.0`, `0.3.0-rc.4`). |

Every object in a manifest is **strict**: a field this page does not list is an error, not
something Adminium ignores. See [Validation](https://docs.adminium.dev/reference/manifest/#validation).
