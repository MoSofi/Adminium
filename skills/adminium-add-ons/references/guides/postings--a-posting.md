<!-- produced from apps/docs/src/content/docs/guides/apps/postings.md § A posting; do not edit -->

# Rows that post into an add-on's ledger: A posting

```json
{
  "ref": "orders",
  "states": {
    "column": "status",
    "initial": "placed",
    "moves": { "placed": ["ready", "cancelled"], "ready": ["picked_up", "cancelled"] }
  },
  "postings": [
    {
      "id": "stock",
      "into": { "addOn": "inventory", "ledger": "stock", "action": "use" },
      "reserve": { "on": { "to": ["placed"] } },
      "post": { "on": { "to": ["picked_up"] } },
      "reverse": { "on": { "to": ["cancelled"], "from": ["placed", "ready"] } },
      "map": { "what": { "row": true }, "quantity": "quantity" },
      "heldUntil": "hold_until"
    }
  ]
}
```

| Field | Rule |
|---|---|
| `id` | The rule's name on this table. Up to six rules a table. |
| `into` | The add-on, one of its ledgers, and one of that ledger's actions. The app names the add-on under [`addOns`](https://docs.adminium.dev/reference/manifest/#add-ons). |
| `reserve`, `post`, `reverse` | When each of the three phases happens. A rule has `reserve`, `post`, or both. |
| `map` | Where each input of the action comes from: a column of the row, the row itself, a column of the row its lines belong to, one of the add-on's settings, or a fixed value. |
| `heldUntil` | For an action that holds: the column that says until when. |

A rule has three **phases**. `reserve` holds something without taking it (stock set aside for an
order that is placed). `post` takes it for good (the order is picked up). `reverse` gives back
whatever the rule has written for this row so far (the order is cancelled). What each phase writes
is the add-on's business; the app only says when.

One life of a rule for a row — held, taken, given back — is a **round**. A row given back and
sent again starts round two. A phase a round has already seen is not run twice: a save sent again
after a lost reply writes nothing new.
