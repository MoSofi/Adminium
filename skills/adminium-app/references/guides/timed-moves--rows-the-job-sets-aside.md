<!-- produced from apps/docs/src/content/docs/guides/apps/timed-moves.md § Rows the job sets aside; do not edit -->

# Timed moves on the venue's clock: Rows the job sets aside

A due row's move can be refused: the lock keeps a column shut, a condition of the move no longer
holds, the connection's database role may not write a column, or the database refuses a value.
The job then **sets the row aside for an hour**. It is logged, and the rows after it move as usual.
A refused row never keeps newer rows waiting.

A row set aside stays in its old state. Staff notice it in the app's screens: an order still
`placed` after closing. The server log names each one with the warning
`timed move refused; left alone for an hour`, with the connection, the table, the row's key, the
number of the rule and the refusal's code.

To fix a row set aside, do one of these:

- **Move it by hand.** A row that has left `from` is never tried again.
- **Fix what refused it,** such as the value a condition waits for. The job tries the row again
  once its hour is over.
- **Give it a new moment.** A row re-dated to a later time is due again only when that time passes.

Two refusals are not set aside. A row that another writer holds (`WRITE_CONFLICT`, or a `*_BUSY`
lock) is tried again the next minute. If the database itself goes away, the minute's job stops and
the next minute starts again, and the rows set aside so far stay set aside.
