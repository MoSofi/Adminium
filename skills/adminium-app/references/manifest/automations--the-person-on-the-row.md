<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Automations — The person on the row; do not edit -->

# Manifest spec: Automations — The person on the row

### The person on the row

A notice's `to: { "column": "owner_id" }` and an email's `to: { "kind": "staff", "column":
"owner_id" }` tell the person a [staff column](https://docs.adminium.dev/reference/manifest/#whose-a-row-is) of the rule's record names. One
link further is allowed: `"deal_id.owner_id"` on a follow-up is the owner of the deal the
follow-up is on. The column must be a staff column; the validator refuses any other.

A record that names nobody there (a deal with no owner yet, an empty link, a person since removed
or suspended) tells nobody, and the run goes on: its log says who was not there. That is not a
failure. An email to a person goes to the address they sign in with, in their language, and waits
for the end of their quiet hours like a notice does.
