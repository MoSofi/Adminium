<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Pages — navLinks; do not edit -->

# Manifest spec: Pages — navLinks

### navLinks

`navLinks` adds entries to the app's sidebar section that are not pages. Up to 24. An entry does
not write an address: it names one of a closed list of places, and Adminium writes the address.

```json
"navLinks": [
  { "ref": "approvals", "label": { "en-US": "Approvals", "de-DE": "Freigaben" },
    "nav": { "group": "selling", "icon": "badge-check", "order": 7 },
    "to": { "side": "staff", "path": "/approvals" } },
  { "ref": "rules", "label": { "en-US": "Rules" },
    "nav": { "group": "setup", "icon": "workflow", "order": 1 },
    "to": { "screen": "automations" } }
]
```

| Field | Required | Rule |
|---|---|---|
| `ref` | yes | kebab-case, up to 60 characters, used once. |
| `label` | yes | A keyed [label](https://docs.adminium.dev/reference/manifest/#conventions) (must include `en-US`). Shown in the reader's language. |
| `nav` | yes | `{ "group", "icon", "order" }`, as a page's: the entry sits among the pages of its group, in `order`. |
| `to` | yes | Where it opens: `{ "screen": … }` or `{ "side": "staff", "path"? }`, below. |
| `module` | no | The [part](https://docs.adminium.dev/reference/manifest/#parts) of the app the entry belongs to. It leaves the sidebar while the part is off. |

| `to` | Opens | Shown to |
|---|---|---|
| `{ "screen": "automations" }` | The dashboard's Automations, showing only the rules this app brought (`/automations?app=<key>`). | Whoever may manage automations. |
| `{ "screen": "email-templates" }` | The dashboard's Emails, showing only the documents this app brought (`/email-templates?app=<key>`). | Whoever may manage settings. |
| `{ "screen": "settings" }` | The app's own page in the console: its parts, its sample data, its add-ons. | Whoever may manage apps. |
| `{ "side": "staff" }` | The app's staff side: its first screen, or the screen at `path`. Inside the dashboard for a side shown there, else on its own address in a new tab. | Whoever may open the staff side (`app:@:staff`), while the side is served. |

`path` is a path under the side: `/` then plain segments (letters, digits, `.`, `_`, `~`, `-`),
with no query, no `#` and no `..`. An entry is listed only to somebody who can open what it opens;
nobody else is told it exists. The two narrowed screens show a line saying what is shown, with a
way back to everything, and they only narrow: nobody sees a rule or an email there that the whole
screen would not list for them. An entry to the staff side needs a `staff` frontend. Needs
Adminium 0.3.28.
