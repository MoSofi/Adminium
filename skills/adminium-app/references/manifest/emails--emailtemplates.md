<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Emails — emailTemplates; do not edit -->

# Manifest spec: Emails — emailTemplates

### emailTemplates

Up to 32 templates. Each is stored as the app's: an operator can edit it, and an edited template
is kept as they left it across updates and uninstalls. A template a new version no longer ships is
removed if nobody edited it.

```json
{
  "key": "clinic-reminder",
  "name": { "en-US": "Visit reminder", "de-DE": "Terminerinnerung" },
  "vars": ["recipient.first_name", "appointment.starts_at.relative_day", "manage_url"],
  "locales": {
    "en-US": {
      "subject": "Your visit {{appointment.starts_at.relative_day}}",
      "blocks": [
        { "block": "email.text", "data": { "text": "Hello {{recipient.first_name}}, see you {{appointment.starts_at.relative_day}} at {{appointment.starts_at.time}}." } },
        { "block": "email.button", "data": { "label": "Manage your visit", "url": "{{manage_url}}" } }
      ]
    }
  }
}
```

| Field | Required | Rule |
|---|---|---|
| `key` | yes | kebab-case, 2–80 characters, starting with the app's key and `-` (`clinic-reminder`). Unique in the manifest. |
| `name` | yes | A plain string or a keyed [label](https://docs.adminium.dev/reference/manifest/#conventions). |
| `vars` | no | Up to 60 variable names the template reads, for the editor's list. |
| `locales` | yes | The template in each language it ships, keyed by BCP 47 tag. `en-US` is required. |
| `attach` | no | `{ "kind", "link", "optional"? }`: a document the email carries, drawn by an add-on for the row the outbox link `link` names (a receipt for a sale). `kind` is a document kind (see [Documents](https://docs.adminium.dev/reference/manifest/#documents)); `link` is one of the outbox's `links`. A message whose document cannot be drawn fails rather than going without it. With `"optional": true`, a message goes without the document while the add-on that draws its kind is not attached and switched on for the app, and every block marked `"data": { "withAttachment": true }` is left out with it ("Your receipt is attached"). Any other failure to draw it still fails the message. |

Each language is `{ "subject", "preheader"?, "blocks", "footer"? }`: a subject and a preheader of
up to 200 characters, 1–40 blocks, and a footer of up to 1000. A block is
`{ "block", "id"?, "label"?, "data"? }`, where `block` is an email block kind such as `email.text`,
`email.heading` or `email.button`. `email.html` is refused: its variables are not escaped, and an
app's emails show values a stranger typed. The install's check step refuses a block kind the
renderer does not know, or data of the wrong shape.

A template reads variables as `{{name}}`: each link by its name (`appointment.*`, and one foreign
key further, such as `appointment.clinician.*`), `recipient.name` and `recipient.first_name`,
`practice.*`, `appName`, `manage_url` and `booking_url`. A time has the forms `.date`, `.time`,
`.day_month` and `.relative_day` ("tomorrow"), in the recipient's language and the venue's zone. A
number has `.number`, `.percent` and `.money`, written exactly as stored in the message's language
(`{{order.tax_rate.percent}}` is "8.25%" on every engine, never "8.250"); a choice has `.label`,
its label in the message's language (`{{order.paid_method.label}}` is "Card", not "card"); a `text`
column of up to 8 characters holding a time of day has `.time`, in the reader's clock ("3:00 PM" in
the US, "15:00" in Britain); a [code](https://docs.adminium.dev/reference/manifest/#column-rules) column has `.grouped` (`K7QX-M2PD`) and `.qr`
(see [Emails that list rows](https://docs.adminium.dev/reference/manifest/#emails-that-list-rows)). A `{{was.<column>}}` reads a
[`was`](https://docs.adminium.dev/reference/manifest/#outbox) column as it was before a change, in the same forms. A
date has `.day_month` and `.days_since` only: a template asking a column for a form its type does
not have (`{{invoice.due_on.date}}` on a `date` column) is refused at install and on update with
`EMAIL_TEMPLATE_INVALID`, naming the template and the variable.
The guide lists [every variable](https://docs.adminium.dev/guides/apps/emails/). A message whose email names a variable
nothing fills (a secret column, a personal column of a linked row, a link the row does not have, a
misspelt name) is not sent: it is `failed`, and its error names the variable. `recipient.name` and
`recipient.first_name` are always filled, empty when the recipient has no name on file.

The code a shared link opens a row with (a `claim: { "by": "token" }` column, a project's
`share_token`) opens a page to whoever holds it, so an email carries it only to the person it belongs
to: the message goes to the address the `recipient` row keeps, and the row with the code is that
person's row or links to it by the recipient's `via` column where it has one (`project.client_id`),
else by every link it has to the recipient's table, all naming them. Any other `code` column (a
booking's reference) is printed like any other value.
A message addressed by hand to another address, or one linking one client and another client's
project, is `failed` with a sentence naming the code. A person or an API key making a message (by
hand, or by an import they started), or queueing a held or failed one to go, may link it only to
rows they can read.

Templates are sent through an outbox, so a manifest with `emailTemplates` and no `outbox` is
refused. The install's check step warns when the server cannot send email.

#### Emails that list rows

An `email.rows` block lists the rows of a child table that link to the row an outbox link names,
one line each: an order's dishes, an order's tickets with a QR code each.

```json
{ "block": "email.rows",
  "data": {
    "from": { "link": "order", "table": "order_items", "via": "order_id", "orderBy": "position",
              "unless": "voided", "limit": 50 },
    "joins": { "options": { "table": "order_item_options", "via": "order_item_id", "column": "name",
                            "orderBy": "position", "separator": " · " } },
    "row": { "title": "{{row.qty}} × {{row.name}}", "meta": "{{row.options}}",
             "amount": "{{row.line_total.money}}" },
    "empty": "Nothing on this order." } }
```

| Field | Rule |
|---|---|
| `from` | `link`, one of the outbox's `links`; `table`, the child table, and `via`, its foreign key back to the linked row; then `orderBy`, `where` (`{ "column", "in" }`), `unless` (a bool column that leaves a row out) and `limit`, at most 50 rows. |
| `joins` | 1–2 lists one level further down, gathered into one text per row under their name (a dish's options): `{ "table", "via", "column", "orderBy"?, "separator"? }`. `column` is a `text` column, never a secret, personal, code, share-code or withheld one. |
| `row` | The text of each line: `title`, `meta`, `amount`, `note`, reading `{{row.<column>}}` in every form the column has, `{{row.<link>.<column>}}` through one of the row's own links, and a join by its name. `image` is a QR code of a code column, `{{row.<column>.qr}}`, and nothing else; without it the line has no image cell. |
| `empty` | Said when there are no rows. Without it, the block is left out. |

`{{row.…}}` is read only inside an `email.rows` block, and every language of a template lists the
same rows (`from` and `joins` are the same in each). A message that lists rows is never sent
without its list: when its table or link can no longer be read (after a rename), the message is
`failed` ("Not sent: the email lists rows from a table or link that is not there"). An empty list
still sends.
