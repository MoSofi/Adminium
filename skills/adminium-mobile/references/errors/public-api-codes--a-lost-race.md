<!-- produced from apps/docs/src/content/docs/reference/errors.md § Public API codes — A lost race; do not edit -->

# Error codes: Public API codes — A lost race

### A lost race

`409` `PUBLIC_SLOT_BUSY` means another write held what this one needed at the same instant. It is
said for every race a guest's write can lose:

- another booking of the same slot or day was being written (`CAPACITY_BUSY`, `BOOKING_BUSY`);
- another row was taking the next number of the same series (`NUMBER_BUSY`);
- two writers changed the same rows at once, a row moved while it was judged, or the database gave
  this write up in a deadlock, a serialization failure or a lock wait (`WRITE_CONFLICT`);
- two creates made the same new person by address at once, twice running.

The same request a moment later goes through or gets its real answer. With a retry key
([`clientKey`](https://docs.adminium.dev/reference/manifest/#dry-runs-price-checks-and-retries)), a retry of a create that
did go through answers that create, marked `replayed`, and makes no second one. On a create with
child rows, `params` names the row where it happened: `child` (the list), `index` and `path`.
The published client counts it as transient (`isTransient`).

It is never said for a slot that is full, a line that is sold out, or a value the guest typed.

**Upgrading:** a lost race used to answer `400` `PUBLIC_WRITE_REFUSED`. Treat both as "try again"
while pages built for the older answer are still in use.
