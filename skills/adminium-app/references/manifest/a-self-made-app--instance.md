<!-- produced from apps/docs/src/content/docs/reference/manifest.md § A self-made app — `instance`; do not edit -->

# Manifest spec: A self-made app — `instance`

### `instance`

The part of the file that is the whole server's: its look and words. It is applied only when the
person installing ticks it, and only by someone who may manage server settings. What it replaced is
recorded, so the app's page can put it back.

```json
"instance": {
  "branding": { "appName": "Fernhill", "accent": "teal",
                "logo": { "file": "instance/logo.png", "sha256": "…" } },
  "languages": { "enabled": ["en_US", "de_DE"], "default": "en_US" },
  "wording": [{ "locale": "en_US", "namespace": "common", "key": "nav.home", "value": "Today" }],
  "systemEmails": [{ "key": "user-invite", "locale": "en_US", "content": { … } }],
  "settings": { "privacy.businessName": "Fernhill Coffee Ltd" }
}
```

| Field | Rule |
|---|---|
| `branding` | `appName` (1–60), `showVersion`, `theme` (`light`, `dark`, `system`), `accent` (`indigo`, `blue`, `teal`, `violet`, `rose`, `red`, `orange`, `black`), `density` (`comfortable`, `compact`), and `logo` and `favicon` as files of the package, each `{ "file", "sha256" }`. |
| `languages` | `enabled` (1–40 language ids such as `en_US`, each once) and `default`, which must be one of them. A language the target does not have is not switched on. |
| `wording` | 1–5,000 changed interface words, each `{ "locale", "namespace", "key", "value" }`, each changed once. A blank value is a word left out on purpose. |
| `systemEmails` | Edited system emails, each `{ "key", "locale", "content" }`, each edited once. `key` is one of `password-reset`, `user-invite`, `notification`, `document-ready`, `booking-confirmation`, `sign-in-code`, `email-changed`, `sign-in-link`, `details-deleted`, `payment-link`, `payment-receipt`, `sign-up-confirm`. The review shows each one's changes and every place its links go, each ticked on its own. |
| `settings` | From an allow-list only: `assistant.name`, `privacy.businessName`, `privacy.noticeUrl` (`https` only) and `email.postalAddress`. Any other setting is refused by name. |

It carries something, or it is left out. It never carries any part of a setting that holds a
secret (the mail server, the assistant's key), people, keys or rows.
