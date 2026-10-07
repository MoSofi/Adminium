<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests — Stock words; do not edit -->

# Manifest spec: Add-on manifests — Stock words

### Stock words

`addOn.words` names a question a page may ask of one of the add-on's [ledgers](https://docs.adminium.dev/reference/manifest/#ledgers) with
nothing written: for each row asked about, is one of it `in`, `low` or `out`. A manifest that uses
it sets `compatibility.minAdminiumVersion` to `0.3.18` or later.

```json
"words": [{ "id": "units-left", "ledger": "units", "action": "use", "input": "what",
            "showLeftBelow": { "setting": "show_left_below" } }]
```

| Field | Rule |
|---|---|
| `id` | kebab-case, unique among the add-on's words. |
| `ledger`, `action` | One of the add-on's ledgers and one of its actions. The add-on's code is asked what that action would do for a quantity of one, in the action's `words` mode. |
| `input` | The action's input that takes the row asked about. |
| `showLeftBelow` | `{ "setting" }`: a column of the add-on's [settings table](https://docs.adminium.dev/reference/manifest/#an-add-on-with-tables-of-its-own). A customer is told how many are left only when fewer than the number it holds are, and only for today. Without it, never. |

A customer's page asks through a public entry of the table the rows are of, with
`"kind": "availability"`, `"methods": ["GET"]` and `"words": "<add-on key>:<id>"` in place of a
limit of the table; such an entry takes no `rule`, `showLeft`, `under` or `unlockBy`. The page asks
`GET /public/availability/<entry>?under=<id>,<id>` with up to 60 row ids. The answer lists
`{ "id", "state", "left"? }` for each row a plain read of the same key would show; any other row
is left out. Answers are kept for five seconds. An add-on that cannot answer (switched off, not
loaded, its code failing) says nothing and every row reads `in`: a page never says "sold out"
because an add-on is off, and the save still refuses what is not there.

Staff ask `GET /api/v1/words/<add-on key>/<id>?table=<stored name>&ids=<id>,<id>` and are told the
same, never from a kept answer. A caller who also reads the add-on's stock tables is given the
figure behind the word: the exact count, the batch a use would take and its expiry, and the line
that runs out first. When the add-on cannot answer, staff are told so (`409`), never "in stock".
