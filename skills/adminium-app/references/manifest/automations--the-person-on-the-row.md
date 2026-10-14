<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Automations — The person on the row; do not edit -->

# Manifest spec: Automations — The person on the row

### The person on the row

A notice's `to: { "column": "owner_id" }` and an email's `to: { "kind": "staff", "column":
"owner_id" }` tell the person a [staff column](https://docs.adminium.dev/reference/manifest/#whose-a-row-is) of the rule's record names. One
link further is allowed: `"deal_id.owner_id"` on a follow-up is the owner of the deal the
follow-up is on. The column must be a staff column; the validator refuses any other.

A record that names nobody there (a deal with no owner yet, an empty link, a person since removed
or suspended) tells nobody, and the run goes on: its log says who was not there. That is not a
failure. Nor does it tell somebody who **cannot open the record**: an approver named on a deal
whose roles do not read deals, or reach other people's only, is neither told nor mailed. A notice
then tells its `else` roles (those of them who can open it); without them, and for an email
always, the log says so. An email to a person goes to the address they sign in with, in their
language, and waits for the end of their quiet hours like a notice does. It reads the record as
they do: a column their role is not shown is empty, and a personal column is there only for
somebody shown that table's personal columns.

An email step may also say where a reply goes: `"replyTo": { "staff": "owner_id" }`, or one link
further, `"deal_id.owner_id"`. The mail then carries the sign-in address of that person as its
Reply-To, whoever it is sent to. It follows the rules of [A reply to the rep](https://docs.adminium.dev/reference/manifest/#a-reply-to-the-rep),
and a rule has no house address to fall back on: with nobody there, the mail goes without a
Reply-To. Needs Adminium 0.3.28.
