<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Automations — A person's name, and the record's address; do not edit -->

# Manifest spec: Automations — A person's name, and the record's address

### A person's name, and the record's address

`{{<staff column>.name}}` is the name of the person a [staff column](https://docs.adminium.dev/reference/manifest/#whose-a-row-is) names, as
Adminium keeps it: `{{asked_by_id.name}}`, `{{record.owner_id.name}}`, or one link further
`{{deal_id.owner_id.name}}`. A column that names nobody, or somebody since removed, writes nothing,
so give it a backup: `{{asked_by_id.name|nobody}}`. A staff column is never a link to another
table, whatever its name: `rep_id` beside a `reps` table names a person, not a rep's row.

An e-mail step sent to a person (`"to": { "kind": "staff", … }`) may carry the record's address,
`{{recordUrl}}`: the address a notice's e-mail button gives, the app's own screen for the record
when the person's roles open it, on the operator's host. Somebody who cannot open the record gets
no address, so give it a backup or tie its block to it. A mail to an address a column holds has
no `{{recordUrl}}`; the validator refuses it there. Both need Adminium 0.3.28.
