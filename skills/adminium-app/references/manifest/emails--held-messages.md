<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Emails — Held messages; do not edit -->

# Manifest spec: Emails — Held messages

### Held messages

A producer with `hold` writes its messages `held`, each with its own due moment, and nothing is
sent until a person approves one. An invoice's three reminders are made when it is sent, each due
some days after its due date; "ready" means held and due.

```json
{ "kind": "invoice-rung-1", "link": "invoice_id", "hold": true,
  "onChange": { "table": "invoices", "column": "status", "to": "sent" },
  "due": { "date": "due_on", "at": "09:00",
           "days": { "setting": { "addOn": "invoices", "setting": "ladders" }, "byColumn": "ladder", "index": 0 } },
  "supersede": "rungs",
  "dropWhen": [{ "column": "balance", "lte": 0, "reason": "paid" },
               { "column": "status", "eq": "void", "reason": "void" }],
  "onSent": { "table": "projects", "via": "project_id", "set": { "status": "paused" } } }
```

What a person may do to a message, through any screen or the data API:

- **Approve** a held one: it becomes `queued`. They may rewrite it first: `bodyOverride` is sent
  in place of the template's blocks, as plain paragraphs, and `subjectOverride` in place of its
  subject. `approvedBy` records who approved it. One approved before its day, or with no day
  worked out, goes at once.
- **Skip** a held or queued one: it becomes `skipped`, with the reason `by-hand`.
- **Queue again** a failed one.

Only Adminium marks a message `sent` or `failed`, and a sent message stays as it was sent. A new
row a person makes starts `queued` or `held`.

Once a minute Adminium looks over waiting messages: it re-dates any whose date inputs moved (a new
due date, a changed ladder), skips those `dropWhen` no longer needs, and skips as `overtaken` the
earlier messages of a `supersede` group once a later one has come due. It also makes a held
producer's message for a watched row in the state that has none of that kind yet (after a crash
between a write and its producer, or for an imported sent invoice). It judges all of this again
just before it sends. `skipReason` records why a message was skipped: `overtaken`, `paid`,
`void`, `no-longer-needed` or `by-hand`.

A held message is made even with no address on file (never for a person who opted out of a
producer that asks `optIn`): the address is looked up again when it is approved and when it is
sent.

An `onSent` change is made after the message's status is saved, as an ordinary write of that
row, and is never a reason to send the message again. It is held to the row's rules and
[states](https://docs.adminium.dev/reference/manifest/#states) like any write, made by Adminium itself, which holds no role: a move kept for
some `roles` is refused to it. `effectAt` records when it was made, or `effectError` why it was
refused.
