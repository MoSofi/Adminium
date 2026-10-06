<!-- produced from apps/docs/src/content/docs/guides/apps/postings.md; do not edit -->

# Rows that post into an add-on's ledger

Some add-ons keep a **ledger**: tables where every change is a row, added up into what is left —
units of stock, the money on a gift card. An order that sells two totes should take two totes off
the shelf, in the same save, or not be saved at all. An app says so with a **posting**: a rule on
one of its tables that hands the row to the add-on at a moment the rule names.

When a save reaches that moment, Adminium asks the add-on's own code which rows to write, checks
the answer, and writes them inside the same transaction as the row itself. If the add-on says no
("there are only 3 left"), nothing is saved. The fields are in the
[manifest reference](https://docs.adminium.dev/reference/manifest/#postings); this page is how they behave.
