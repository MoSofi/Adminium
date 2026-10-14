<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Automations — The lead of the person on the row; do not edit -->

# Manifest spec: Automations — The lead of the person on the row

### The lead of the person on the row

```json
{ "kind": "notification", "to": { "column": "asked_by_id", "lead": true, "else": { "roles": ["admin"] } },
  "title": { "en-US": "Quote {{record.number}} needs your approval" } }
```

With `"lead": true` the notice goes not to the person the staff column names but to **whoever
leads a team that person is in** (Settings → Teams), never to the person themselves, and only to a
lead who can open the record. When there is none (she is in no team, she leads her own team and
nobody leads her, or her lead's roles do not reach the record) the holders of the `else` roles who
can open the record are told instead, again never the person. A notice to a lead always says
`else`; the validator refuses one without. `else` also works without `lead`: a record whose column
names nobody then tells those roles instead of nobody. A team she leads herself, alone or with
others, leads her not: a co-lead of her own team is not told as her lead. Needs Adminium 0.3.28.
