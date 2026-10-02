<!-- produced from apps/docs/src/content/docs/guides/apps/booking-rules.md § Locks and busy writers; do not edit -->

# Booking rules and limits: Locks and busy writers

Two guests pressing Buy for the last seat must not both get it. So Adminium counts a pool under a
lock only the writers of that pool wait for, held until the write commits:

| Kind | Rows judged together |
|---|---|
| `slot` | Every row of one venue day. |
| `parent` | Every row sharing the `lockBy` value, or the whole rule without one. A wider pool `lockBy` does not follow takes a lock of its own. |
| `night` | Every row of the table. |

A write names its locks before it starts. If the row moved to another pool in between, it names
them again and starts over, up to three times, then answers `409` `WRITE_CONFLICT` with
`details.retry: true`.

On Postgres and MySQL a writer waits at most 10 seconds for a lock another writer holds, then
answers `409` `CAPACITY_BUSY`. Try again. Writers of one server also queue in memory before they
take a database connection, so a rush on one show does not starve every other page.

A write of several rows at once (a bulk change, a public batch) holds no pool lock. A row in it
that could take from a limit (a create that counts, or a change that moves a row's pool, what it
takes, or into a counted state) is refused: staff get `409` `CONFLICT` with the reason
`CAPACITY_ONE_AT_A_TIME`, a guest `400` `PUBLIC_WRITE_REFUSED`. A change out of counting goes
through: a bulk cancel is fine. An import and sample data are written as history and are not
judged.

> **Caution: Upgrading**
> The names of the limit locks changed after 0.3.4: a slot limit now locks a whole venue day.
> Two servers running different versions take different names, so during a rolling deploy a slot
> can be oversold. Deploy every server at once.

### An index for the counts

A limit counts rows by their foreign keys: the pool's `via`, a wider pool's, `perWrite.within`,
the owner's and a stay's. Mark those columns `index: true`, so the count under the lock reads the
rows it needs and not the whole table:

```json
{ "ref": "ticket_type_id", "type": "fk", "references": "ticket_types", "index": true }
```

`index` is only for a foreign key a limit or a [total](https://docs.adminium.dev/reference/manifest/#totals-that-count-and-climb)
counts by, and not for a unique column.
