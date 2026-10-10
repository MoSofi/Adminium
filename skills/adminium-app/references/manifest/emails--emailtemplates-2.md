<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Emails — emailTemplates; do not edit -->

# Manifest spec: Emails — emailTemplates

A QR code is the whole value of an image: an `email.image` block's `qr`, written
`{{<link>.<column>.qr}}` (80–200 pixels across, `size`), or a row's `image`. It is drawn when the
message is delivered, only of a code column, and only for a code of at most 64 bytes. A code the
[withhold](https://docs.adminium.dev/reference/manifest/#withheld-columns) or share-code rules keep from the message's recipient is printed
empty, in every form, its QR code included.

#### Blocks sent only with a value

A block's `data` may carry `onlyWith` or `onlyWithout`, the name of one variable the template
reads (`"onlyWith": "card.balance"`). With `onlyWith` the block is sent when the variable holds
something; with `onlyWithout`, when it does not. Empty means missing, blank, or held back from
this reader. The block is dropped before the message is checked, so a variable read only inside a
dropped block may stay empty, and the HTML and the plain text drop the same blocks. A manifest
that uses either sets `compatibility.minAdminiumVersion` to `0.3.18` or later. A template with
such a block is sent by the outbox only, never by a rule the manifest [ships](https://docs.adminium.dev/reference/manifest/#automations).

#### A value that is missing

A variable may carry a backup after a bar: `{{recipient.first_name|guest}}` writes "guest" when
the value is missing or blank, and `{{recipient.first_name|}}` writes nothing. The backup is plain
text with no braces. A name written with a backup everywhere need not be filled.

A block may be tied to a value beside its `block` and `data`: `"showWhen": { "var": "stay.note" }`
sends it only when that variable holds something, and on an `email.text` or `email.heading` block
`"otherwise"` is the text sent in its place when it does not. Unlike `onlyWith`, both are read by
the renderer itself, so a template that uses them may be sent by a rule too. A manifest that uses
either sets `compatibility.minAdminiumVersion` to `0.3.22` or later.

#### An add-on's links into an app

An add-on has no customer side of its own. Its outbox may name routes of whichever app it serves:

```json
"pages": { "app": { "balance": "giftCard" } }
```

`app` maps a kebab-case name of the add-on's own to the key of a route an app declares on its
customer side. A template reads it as `{{app_url.balance}}`: the address of that route in the
first app, by key, that names the add-on, has it connected and switched on, declares the route and
has a customer address. With no such app the variable is empty, so put the button that uses it in
a block marked `onlyWith`.

#### Rows of an add-on's table in an email

An `email.rows` block may list an add-on's rows for the row a link names, found by the same
[pair](https://docs.adminium.dev/reference/manifest/#a-list-of-an-add-ons-rows) a document uses:

```json
"from": { "link": "sale", "addOn": "offers", "table": "applications",
          "match": { "table": "source_table", "row": "source_row" }, "orderBy": "id", "limit": 20 }
```

While the add-on is absent, detached or switched off the list is empty and the message still goes
(the block's `empty` text is said, or the block is left out). A `match` column the add-on's table
no longer has fails the message with a reason.
