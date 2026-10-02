<!-- produced from apps/docs/src/content/docs/guides/apps/sample-data.md § Removing it; do not edit -->

# Sample data: Removing it

**Remove sample data** on the card, or **Remove it** on the banner, opens a preview first:

- **Removes** — how many sample records go, per table.
- **Kept** — the sample records you have made your own:
  - a sample record one of your own records uses is **always** kept, with the records it points at
    in turn. Removing it would break your record;
  - a sample record you edited since it was added is kept while **Keep the ones I changed** is
    ticked, which it is by default. The preview names them. Untick the box to remove them too.

**Remove** then deletes the rest in one transaction. If the database refuses a delete because
something still points at a sample record, **nothing** is removed and the message names the table.

When it is done:

- **Kept records are yours.** They leave Adminium's list and are never treated as sample data
  again.
- **The list ends empty,** so the card reads **Not loaded** and **Add sample data** is offered
  again. Adding it again starts afresh.
- **Images follow their records.** An image goes to the trash in **Files** unless a kept record
  still uses it, and is deleted for good like any other
  [trashed file](https://docs.adminium.dev/guides/files/#deleting-is-not-deleting).

A message on the card says how many sample records stayed, if any.
