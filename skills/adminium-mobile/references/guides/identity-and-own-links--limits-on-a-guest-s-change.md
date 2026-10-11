<!-- produced from apps/docs/src/content/docs/guides/apps/identity-and-own-links.md § Limits on a guest's change; do not edit -->

# Guests, their details and their own links: Limits on a guest's change

Sending a ticket to a friend is an email to an address the buyer chose, with a name they typed.
Without a limit, the box office's mail becomes anyone's relay. `limits` holds a change to what a
stranger's create is held to:

```json
"limits": { "perValue": { "columns": ["pending_email"], "n": 5 }, "plainText": ["pending_name"] }
```

- **`perValue`**: at most `n` changes a day that write one value, counted across every table of
  the connection: five tickets a day to one friend, however they are sent. An address counts as
  its mailbox, in lower case, with a `+tag` dropped and, for Gmail, its dots too. Over the limit,
  the change is refused `409` `PUBLIC_LIMIT_REACHED`. A change that does not go through hands its
  count back, and a [dry run](https://docs.adminium.dev/reference/manifest/#dry-runs-price-checks-and-retries) is never
  counted.
- **`plainText`**: the columns hold plain text. A value that is not is refused `400`
  `PUBLIC_WRITE_REFUSED`, with `params.column` naming the column.

`limits` goes on an entry with `PATCH`. Each column is a writable text column. A create uses
`anonymous` instead ([Limits on a stranger's create](https://docs.adminium.dev/guides/apps/public-access/#limits-on-a-strangers-create)).

### Plain text

Plain text is letters (of any alphabet), spaces and the punctuation a sentence is written with,
up to 80 characters: no digits, no `://` and no `www.`. The punctuation is

- Latin: `. , ' ’ ( ) & - ! ? : ; "` and `¿ ¡ « » „ “ ”`;
- CJK: `，。、！？：；「」『』・`, so "少放辣，切六块。" passes;
- Arabic: `، ؛ ؟`.

Every `plainText` list (`anonymous.plainText`, `limits.plainText` and a child row's `plainText`)
also refuses:

- an `@`, so no handle;
- a `/`, so no path;
- a dotted word whose last part is a known web ending, such as `evil.com`, `claim.refund.net`,
  `shop.co.uk` or `refund-desk.cafe`. The ending is read as a reader sees it: fullwidth letters,
  an accent or an invisible mark on it, and a hyphen after it change nothing, and the ideographic
  full stop `。` is a dot, as a browser reads it (`evil。com`).

A column in a `plainText` list is a name by default. A note that may hold a few digits and run
longer names them:

```json
"plainText": ["name", { "column": "note", "digits": 4, "max": 140 }]
```

- **`digits`**: 1–4 digits in the whole value, in any script ("2 without onions", "table 12",
  "flat 3B, door 12"), so never a phone number. A digit is part of a dotted word too: `shop1.com`
  is refused.
- **`max`**: up to 200 characters, instead of 80.

The validator warns when a column's `maxLength` is longer than its plain text takes: a guest who
types to the end of the field would be refused.

"Mary.Ann", "J.R.R. Tolkien" and "St. John" are names, and pass; so is "x dot com", which names no
address. Initials before a surname pass too ("W.Hu", "K.Y.Ng", "M.De Vries"), unless the surname is
an ending an address is always read in (`X.Com`, `J.Co`). A name like `refund-desk.com Smith` is
refused. The rule refuses web and email addresses in their common forms; the endings it knows are
a list, so an address ending in one it does not know still passes.

A column a create lists under `anonymous.plainText` is judged on every write of it: the create
itself, signed in or not (a name the person's account fills in too), and every change of the row
that writes it, through its own link, a signed-in person's rows or a batch. A person's own column
that `identity.fill` fills such a column from (the account's `name` into an order's `buyer_name`)
is judged the same way on the account's change. The refusal says `params.column`; its message
names the rule.

### A visitor's hour

A create through an entry with `anonymous` limits also holds each visitor to 60 an hour through
the key. A visitor is an IP address, or an IPv6 subscriber's whole /64. `anonymous.perIpHour`
lowers that for one entry, from 1 to 60; it is counted before the whole key's hour, so one visitor
cannot spend it for everyone. Over it, the create is refused `409` `PUBLIC_LIMIT_REACHED`. See the
[manifest reference](https://docs.adminium.dev/reference/manifest/#limits-on-a-guests-change).
