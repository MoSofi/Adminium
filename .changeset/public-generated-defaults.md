---
'@adminium/server': patch
---

**The public surface can generate a value.** A scope resource's `defaults` may
now carry `{"$generate": "uuid"}` or `{"$generate": "now"}`, resolved
server-side per request.

Nothing on the public create path generated anything before: add-on DDL emits no
column defaults, `insertRow` writes what it is handed, and scope `defaults` were
static JSON — so every add-on table row in existence was written by an add-on's
server half. An anonymous visitor could not create a row at all, and both ways
round it are refusals: a writable primary key is a compile error, and browser
code may not reach `crypto`. This is the smallest primitive that closes it, and
it is general — every app whose intent rows sit on an `id`-typed table needs
exactly this, and `created_at` needs it too.

`compileScope` refuses a sentinel that is malformed, names an unknown generator,
or sits on a column the same resource lists `writable` — a generated value
exists precisely because the caller may not choose it, and a document that says
both is a contradiction a reader can resolve two ways. It also now checks
`defaults` against the schema snapshot, which was the one list it never did.

Two fixes travel with it, both owed with or without any add-on:

- **A public write is published to the widget-data stream.** `routes/data` has
  fanned every write out to `widget-data:<connection>:<table>` since the widget
  registry shipped; the public routes published nothing, so a dashboard page
  bound to a table a customer can write to learned about that write only on its
  next refetch. The row is masked by the same publisher as every other frame on
  that channel.
- **The sentinels resolve on create and are dropped on update.** `defaults` are
  applied on both paths, which is harmless for a literal and a data-loss bug for
  a generated one: a visitor patching their own row would have been handed a
  fresh primary key each time.

Both generators round-trip on postgres, mysql and sqlite. The instant is
formatted per dialect — MySQL's `datetime` refuses the ISO form the other two
want, and no single JavaScript value satisfies all three drivers.
