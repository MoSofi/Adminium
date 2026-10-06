---
title: Rows that post into an add-on's ledger
description: How a table's rule hands its rows to an add-on that keeps a ledger (stock, gift cards) in the same save, the four moments a rule fires on, lines of an order, what each way of writing a row does, what "put it back first" means, a hold's end, the answer of a dry run, and what happens when the add-on cannot be asked.
---

Some add-ons keep a **ledger**: tables where every change is a row, added up into what is left —
units of stock, the money on a gift card. An order that sells two totes should take two totes off
the shelf, in the same save, or not be saved at all. An app says so with a **posting**: a rule on
one of its tables that hands the row to the add-on at a moment the rule names.

When a save reaches that moment, Adminium asks the add-on's own code which rows to write, checks
the answer, and writes them inside the same transaction as the row itself. If the add-on says no
("there are only 3 left"), nothing is saved. The fields are in the
[manifest reference](/reference/manifest/#postings); this page is how they behave.

## A posting

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
| `into` | The add-on, one of its ledgers, and one of that ledger's actions. The app names the add-on under [`addOns`](/reference/manifest/#add-ons). |
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

## The moment a phase fires

| A point | Fires |
|---|---|
| `{ "create": true }` | when the row is created |
| `{ "to": ["placed"] }` | when the row moves into one of these states, or is created in one |
| `{ "to": ["cancelled"], "from": ["placed", "ready"] }` | only when it moves there from one of those states |
| `{ "column": "status", "in": ["seen"] }` | when a plain column takes one of these values (a table with no [states](/reference/manifest/#states)) |
| `{ "column": "voided_at", "set": true }` | when a column that was empty is filled |

A change that crosses no point posts nothing and costs nothing: the row is saved as ever.

`from` is how an app says a give-back is no longer possible. An order whose stock goes back when
it is cancelled from `placed` or `ready`, and not once the kitchen is `preparing` it, leaves
`preparing` out of `from`.

## The lines of an order

Most orders sell several things. The rule then sits on the **lines'** table and names the link to
the order with `via`:

```json
{
  "ref": "order_lines",
  "postings": [
    {
      "id": "stock",
      "into": { "addOn": "inventory", "ledger": "stock", "action": "use" },
      "via": "order_id",
      "reserve": { "on": { "create": true } },
      "post": { "on": { "to": ["picked_up"] } },
      "reverse": { "on": { "to": ["cancelled"], "from": ["placed", "ready"] } },
      "map": { "what": "item_id", "quantity": "quantity" },
      "heldUntil": { "parent": "hold_until" },
      "unlessSet": "voided_at"
    }
  ]
}
```

Under `via`, a point is judged on the **order**: when the order moves to `picked_up`, every line
is handed to the add-on in one call. Two points are the line's own: `{ "create": true }` (a line
is held as it is added) and a column point marked `"own": true` (a payment voided by its own
`voided_at`).

- A line added to an order whose other lines are already held is held in the same save. One whose
  order has already been picked up is taken in the same save.
- `unlessSet` leaves a line out of every call while that column is filled: a voided line of a till
  ticket hands nothing over.
- `only` hands over only the lines that match: `{ "column": "method", "eq": "gift_card" }` on a
  table of payments, so a cash payment is never a card's.
- `{ "parent": "hold_until" }` reads a column of the order rather than of the line.

Two tables of lines under one parent give their rules different ids.

## Put it back first

While a round is open for a row — something is held or taken and not given back — the row is
kept as the add-on read it:

- A column the rule maps, multiplies by or filters on cannot be changed:
  `409 POSTING_REFUSED {reason: "mapped-changed", column}`.
- The row cannot be deleted: `409 POSTING_REFUSED {reason: "receipt-open"}`.

The way through is the rule's own `reverse`: cancel the order (or void the line), change it, and
send it again. That is "put it back first". A line with no open round changes freely.

A many-row change is held to the same thing and to one more: it cannot move a row into a state
its rules take things for good in while a payment of that row is still kept until a time. Only a
save of that one row tells the payment it now stands.

The same holds for the rule itself. An owner's rule that rows still hold something under keeps
where it goes, when it fires and what it hands over, and cannot be removed, until those rows are
put back: `409 POSTING_REFUSED {reason: "receipt-open", rows}`.

## A hold has an end

An action that holds needs to be told until when, or a customer who never comes back keeps the
stock for ever. `heldUntil` names a date-and-time column of the row (or of its order). When that
moment passes and nothing has taken or given back the hold, Adminium's
[minute job](/guides/apps/timed-moves/#a-hold-that-nobody-finishes) gives it back, as the rule's
`reverse` would.

A table whose state has a [timed move](/guides/apps/timed-moves/) into a state the `reverse` point
names needs no `heldUntil` for that: the move itself gives the hold back.

When a buyer's new hold lets their old one go (the public API brings the old order's end forward),
what the ledger holds for the old order is brought forward with it, and given back by the next
minute's run. Until then the old hold still counts: a buyer taking the very last ones again may be
told they are out for up to a minute.

## What a rule cannot stand on

Two things change a row with no save of it, so nothing would tell the ledger. A rule that depends
on either is listed as unavailable on the rules page, and an owner's cannot be saved:

- a column that is a [copy that follows](/reference/manifest/#copies-that-follow) the row it is copied from —
  as an input, a multiplier, `heldUntil`, `unlessSet`, `only` or `via`. Map the column it is copied
  from, or a copy that does not follow;
- a point on the state a place kept for a waitlist is moved to when it is claimed (`releaseTo`).

## Every way of writing a row

A rule fires on a save of **one row**, and on a create of a row with its child rows. Everything
that writes many rows in one go is refused when one of them would fire a rule, change what an open
round read, or delete a row with an open round — rather than write rows the ledger never heard of.

| Way in | A rule fires |
|---|---|
| A create, a change, a button on a record; a create with child rows | yes |
| A guest's create or change through an app's [public access](/guides/apps/public-access/) | yes |
| A [timed move](/guides/apps/timed-moves/), an automation's step, project code | yes |
| `POST /data/:connection/:table/one-by-one` | yes, one save a row |
| A bulk edit, an [undo](/guides/apps/undo-a-status-move/), a form's child rows, a public batch, a [state's effect](/reference/manifest/#states) on another row | no: `409 POSTING_REFUSED {reason: "one-at-a-time"}` when it would |
| An import, sample data | a new row is history: nothing is posted and nothing refused. A change of a stored row that would post is that row's own refusal, and the import goes on |
| A row the add-on's own code writes | never: its tables' own rules do not fire on it |

A list page's bulk change that is refused this way is sent again row by row through the
one-by-one route, and says what became of each.

A save that posted cannot be undone with an Undo: its reply carries no undo token. The rule's
`reverse` point is the way back.

## Trying a save first

A [dry run](/reference/manifest/#dry-runs-price-checks-and-retries) asks the add-on too, and writes
nothing. A ledger's refusal is its **answer**, not a failure:

```json
{ "data": { "…": "…" },
  "postings": [{ "ledger": "stock", "state": "refused", "reason": "out-of-stock", "line": 2, "left": "3", "item": "Tote" }] }
```

`state` is `ok`, `refused` or `unavailable`. `left` and `item` are told only to a caller who may
read the ledger's own tables; a guest is told what the add-on's owner chose to show. A dry run
reads without locking, so it can say `ok` a moment before somebody else takes the last one: the
save is what decides, and is told the same reason.

## When the add-on cannot be asked

An add-on's code may be missing for a while: it is being updated, switched off for the app, or its
files are not there.

| The rule's add-on is | A save that would fire the rule |
|---|---|
| not installed here, or not connected to the app | goes through. The rule reads as not there. |
| installed, and cannot answer now | a `reverse` always goes through; a `reserve` or `post` is refused `409 POSTING_REFUSED {reason: "add-on-unavailable"}` — unless the action says which rows may be taken unasked (stock a shop sells whether or not the count is right), and every row it would take from says so |
| switched off by the owner (the rule's own switch) | starts nothing; a round already open is still given back |

A save let through unasked leaves a receipt marked as waiting. Nothing is taken off the ledger
yet. The add-on's rules page says how many wait and offers **Record them now**, which works them
out oldest first once the add-on can answer.

A rule that names something the add-on does not have — an action or an input from another
version, a column that is gone — cannot answer either. It is listed as unavailable on the rules
page and never half-run.

## What the owner can change

An app's rules arrive with it and change with its updates. The owner of a workspace can switch
each one off (and on again), and can draw rules of their own on any of their tables, on the
add-on's rules page. A rule switched off starts nothing new and still gives back what it holds. An
update of the app never switches it back on.

An owner's rule and switch travel in the project's
[schema file](/projects/page-files/#a-schema-file) with the workspace's other customizations; an app's rules do not,
and are untouched when a file is applied.

## What a writer is told

| Code | Reason | Meaning |
|---|---|---|
| `POSTING_REFUSED` | `out-of-stock`, `expired`, `needs-batch` | the add-on's own refusal on a stock ledger |
| | `not-valid`, `inactive`, `void`, `empty`, `used-up`, `over-limit`, `needs-customer`, `refund-over` | the add-on's own refusal on a ledger of value (a card, a voucher) |
| | `mapped-changed`, `receipt-open` | put it back first |
| | `one-at-a-time` | this way of writing cannot post: save the row by itself |
| | `add-on-unavailable` | the add-on cannot be asked now |
| | `planner-failed`, `too-large`, `hooked`, `guarded` | a fault of the add-on or of the setup: an audit row `ledger.refused` says which |
| | `card-pays-card` | a line of the same order forbids it |
| `WRITE_CONFLICT` | | something this save stood on moved while it waited: send it again |
| `CAPACITY_BUSY` | | another save held the same ledger rows for ten seconds: send it again |

A guest hears two of these by name: `PUBLIC_OUT_OF_STOCK` (with the line, and what is left when
the owner shows it) and `PUBLIC_CARD_REFUSED` (always `not-valid`, whatever the real reason: a
stranger learns nothing about a card they do not hold — a code that names no card at all is told
in the same words). Every other reason reaches a guest as the
plain refused write. The full lists are in the [error reference](/reference/errors/#a-ledgers-refusal).
