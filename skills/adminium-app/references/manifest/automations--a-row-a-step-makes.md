<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Automations — A row a step makes; do not edit -->

# Manifest spec: Automations — A row a step makes

### A row a step makes

A `record.create` step with `"name": "contact"` keeps the row it made, and every step after it may
read `{{steps.contact.<column>}}`: an enquiry makes a contact, then a deal for that contact, then
a follow-up on that deal, in one rule. The row is kept in the run's stored trace, so it is still
there after a `wait`.

A notice, or a mail to a person, carries what **that person** reads of the row: nothing of it for
somebody whose roles do not read its table or reach that row (a costing made for an approver, told
to the deal's owner), and nothing of a column their role is not shown. A personal or secret column
of the row is never kept for the steps after.

A `{{steps.…}}` that names a row no step before it makes, or a column that row's table has not,
is refused by the validator and when a rule is saved. A run that reaches a step whose row was not
made (it was made on the other side of a branch) stops there and fails by name: the text is never
written with the braces left in. A test run makes no rows; it reads a stand-in and says so.

A manifest knows nothing of the install it lands on, so a shipped rule differs from one drawn on
the rules page in three ways:

- Tables are the manifest's own, by their short names. It names no connection and no time zone: a
  rule by the clock runs on the database's zone, else the server's.
- A notice goes to the manifest's own roles and an email to a column of the record: never a fixed
  address, a user, a web address or a document.
- An email's template carries no document and no block marked `withAttachment`, `onlyWith` or
  `onlyWithout`: those are the outbox's.

A condition is `{ "left", "op", "right"? }`. `left` is `{ "field" }`, a column of the record, or
`{ "count": { "table", "matchColumn", "equalsField", "where"? } }`, a count of related rows. On a
yes/no column only `is` and `is_not` are allowed, with `"true"` or `"false"`. A count cannot be
used in a schedule's `forEach.where`: keep the count in a [rollup](https://docs.adminium.dev/reference/manifest/#totals-and-balances)
column and compare that. A `changedColumn` that is a total Adminium settles after the save needs
a formula column over it with `"announce": true`. A rule that visits each row `once` needs a
condition that picks the row.

Each rule is installed with the app or add-on and listed on the rules page under "From your
add-ons" or "From your apps". The owner may switch it, test it and copy it; a shipped rule itself
is never edited or deleted there (`409` `AUTOMATION_MANAGED`). An update rewrites a rule nobody
changed, keeping the owner's switch, and removes one the new version no longer ships. While its
add-on is switched off a rule is skipped. Uninstalling removes the shipped rules.

Whether each of an app's own rules is switched on can be read by the app's own people, for a
screen that depends on one: see
[Whether a rule is switched on](https://docs.adminium.dev/guides/apps/building-a-side/#whether-a-rule-is-switched-on).
