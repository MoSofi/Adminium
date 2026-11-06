<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Roles; do not edit -->

# Manifest spec: Roles

`roles` declares roles the app brings, such as a cashier and a manager. Each is installed as
`<key>-<role key>` (`pos-cashier`) and belongs to the app.

```json
{
  "key": "cashier",
  "name": "POS cashier",
  "screensOnly": true,
  "permissions": ["table:@tickets:read", "table:@tickets:create", "page:@pos-menu:view", "app:@:staff"]
}
```

| Field | Required | Rule |
|---|---|---|
| `key` | yes | kebab-case. The full `<key>-<role key>` must fit in 40 characters. |
| `name` | yes | 1–80 characters. The English name. |
| `names` | no | The name in other languages, keyed by BCP 47 tag (`{ "de-DE": "Kassierer" }`), each 1–80 characters. A reader sees their own language until the owner renames the role; a renamed role is shown as the owner wrote it, in every language. Needs Adminium 0.3.28. |
| `modules` | no | 1–16 ids of the [parts](https://docs.adminium.dev/reference/manifest/#parts) of the app the role belongs to. The role is offered while any of them is on. Needs Adminium 0.3.28. |
| `permissions` | no | Grants, in the forms below. |
| `cloneFrom` | no | The key of another of this app's roles, whose grants this role also gets, and its `limits`. |
| `screensOnly` | no | `true`: people with this role open the app's own screens and never the dashboard. |
| `limits` | no | Per table ref, what the role's `update` there may change, what its `read` there shows, and which [rows](https://docs.adminium.dev/reference/manifest/#whose-a-row-is) its read, update and delete reach. See below. |

A manifest cannot know the real table names or page ids, so it grants through placeholders:

| Grant | Actions |
|---|---|
| `table:@<table ref>:<action>` | `read`, `create`, `update`, `delete`, `export`, `import`, `read_pii` |
| `page:@<page ref>:<action>` | `view`, `edit` |
| `app:@:staff` | Open the app's staff screens. |
| `addOn:<add-on key>:settings` | Edit that add-on's non-secret settings (the letterhead of an invoicing add-on). Only an add-on the app requires or suggests in [`addOns`](https://docs.adminium.dev/reference/manifest/#add-ons). A holder who does not manage add-ons finds a row for it in the rail's Library group, opening `/add-on-settings/<add-on key>`: the add-on's own settings control (its `settings.add-on.panel` fill, such as the closed-days picker of Holiday Calendars) above the generated fields. Needs Adminium 0.3.47. |
| `page:@<add-on page or panel id>:view` | See a page or a record panel of an add-on the app requires or suggests (`page:@customiser-line:view`). The id starts with the add-on's key. `view` only. Needs Adminium 0.3.44. A page of an add-on made only for certain apps (one whose `attaches` does not name the dashboard) is on the dashboard while one of those apps has it connected and switched on, at `/add-ons/<add-on key>/<page ref>`, from 0.3.47. A screens-only role that holds the grant fetches the files shipped beside that page (`/api/v1/add-ons/<add-on key>/pages/<page ref>/files/…`, a starter font its panel draws with), not the page itself. |
| `privacy:@:people` | Find, download and erase a person's data, on the dashboard's privacy page (`/studio/privacy?tab=person`). See below. Needs Adminium 0.3.47. |

`privacy:@:people` is given as the console key `system:privacy:people`: the role may search what
the app keeps about one e-mail address, download it for the person, and erase them, past every
role's table and row limits. It is how a shop's owner answers a customer's request without being
the Super Admin. It reaches only the apps whose roles give it to the person: those apps' people
tables, the copies they declare (with the add-on rows those copies' links reach) and their
outboxes, the consent rows about those rows, and what Adminium keeps about them (campaign mail,
documents, payments, rule runs, notifications and files of those rows). Never another app's people,
never the do-not-email list or a forms add-on's answers (the server's), never a store that only
names the address, and never an address that is a staff account's: that is refused (403
`STAFF_ADDRESS`), since erasing it would rewrite the audit log. The erasure deletes the downloads
the holder made, not other people's. Whoever holds `system:privacy:manage` reaches everything, as
before. It never opens the privacy notice, the
websites or how long things are kept (`system:privacy:manage`, the Super Admin's). The privacy page
opens on "A person's data" alone for such a role. The install check names every role that would
hold it before anyone agrees. The plan refuses it on a `screensOnly` role (the privacy page is the
dashboard's) and on an add-on's role. A version that drops it takes it back. Like every app
grant it is given once: an owner who takes it away keeps it away.

```json
{ "key": "owner", "name": "Owner", "permissions": ["table:@customers:read", "privacy:@:people"] }
```

A new version that gives `privacy:@:people` or an add-on's settings (`addOn:<add-on key>:settings`)
to a role whose running version did not have it — a new role too — is updated only when whoever
updates allows it: the update's check marks each such grant (`added`), the dashboard's update
dialog shows it, and an update sent without `"roleGrants": true` is refused (422
`ROLE_GRANTS_ADDED`) before anything moves. A `screensOnly` role that clones (`cloneFrom`) a role
holding `privacy:@:people` is refused as if it named it. From Adminium 0.3.47.

An add-on's page or panel is given as the role's [`tables`](https://docs.adminium.dev/reference/manifest/#a-role-on-an-add-ons-tables)
are: while that add-on is installed in the same database, attached to the app and switched on.
It is taken back when that stops, and given again when the add-on is back. An owner who takes
it away from the role keeps it away. The install's check refuses an id the add-on has neither as
a page nor as a panel. A record panel also needs the role's grant on the panel's table (its
`tables` entry) and on the record's own table.

`read_pii` shows the table's personal columns in clear. Without it they read as `null`, listed in
the row's `_masked`. A lookup into another table needs `read_pii` on that other table. See
[Personal data](https://docs.adminium.dev/guides/apps/roles-and-staff-access/#personal-data).

The plan refuses a `system:` grant, a wildcard, and a reference to a table or page the manifest
does not declare. Grants are given once: an update adds what a new version asks for, and an
operator's narrowing of an app role survives it.

`limits` narrows the role's `update` on a table to some columns and, for some of those, to some
values. The names are the ones [public access](https://docs.adminium.dev/reference/manifest/#public-access) uses:

```json
{
  "key": "clinician",
  "name": "Clinician",
  "permissions": ["table:@appointments:read", "table:@appointments:update", "app:@:staff"],
  "limits": {
    "appointments": {
      "writable": ["status"],
      "writableValues": { "status": ["roomed", "with_clinician", "ready"] },
      "writableFrom": { "status": ["checked_in", "roomed", "with_clinician"] }
    }
  }
}
```
