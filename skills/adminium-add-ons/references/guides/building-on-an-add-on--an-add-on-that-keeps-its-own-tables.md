<!-- produced from apps/docs/src/content/docs/guides/building-on-an-add-on.md § An add-on that keeps its own tables; do not edit -->

# Building on an add-on: An add-on that keeps its own tables

Invoices & Receipts gives your app a shape to build its own tables on. Inventory (`inventory`)
does not: it keeps its own tables (items, places, stock levels, movements) and a ledger, `stock`.
An app that uses it builds **no** stock table. It writes three things:

1. **A link.** A column of your table that holds the key of one of the add-on's rows:
   `"rules": { "addOnLink": { "addOn": "inventory", "table": "items" } }` on an `int` column. No
   foreign key is made, so the app installs with or without the add-on.
2. **A rule.** [`postings`](https://docs.adminium.dev/guides/apps/postings/) on your table: when a row is saved, or moves
   to a state, it is handed to one of the ledger's actions, which takes the stock.
3. **A grant.** `tables` on your role, so the person who fills the link can read the add-on's
   rows to pick one. See "Your app's roles on an add-on's tables" below.

Every name in the rule is the add-on's: the ledger, the action, and each input the action takes
are under `addOn.ledgers[].actions` in its manifest. Copy them from there. The install checks
each one against the add-on it runs on and refuses a rule that names an input the action has not,
or leaves out one it needs.

**Require it, or suggest it.** Under `requires`, the add-on is installed with the app, and the
rule always runs. Under `suggests`, the app runs without it: give the rule `"needs": "<feature>"`
and declare that feature under `addOns.features`. The rule is then live only while the add-on is
installed, connected to the app and switched on. A row saved while it is not live posts nothing,
and is not caught up later.

**Sample rows.** The app's sample data may add rows to the add-on's tables (items for the
clinic's shelf) in a second file, and name the add-on's own sample rows by their labels:
[Rows for an add-on the app names](https://docs.adminium.dev/guides/apps/sample-data/#rows-for-an-add-on-the-app-names).

**What try shows.** `adminium app try --add-ons <folder>` installs the add-on, then the app, and
loads the sample data. A sample row never posts, so **try** proves the rule is accepted, not that
stock moves. To see stock move, run the app, receive some stock in Inventory, and save one row.
