---
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/docs': patch
---

An app's email can now wait for a feature and a setting at once: `gate: { feature, setting: { table, column } }` queues the message only while the feature is on (its add-ons attached) and that switch of the app's settings row is on. A restaurant's receipt goes only while Invoices & Receipts is attached and the manager has receipts switched on. Each half is checked as it is when used alone, and the gates that name one thing behave as before.

A move that takes back another (`undo: true`) now works out of a locked state. What it empties, its `clearOnBack` stamps and the new `clears` list of further columns it names (how a hand-over taken back was paid), is open to the table's lock for that move only, and only to be emptied. A manager taking back a picked-up order used to be refused with `RECORD_LOCKED`; now the order is ready and unpaid again, its hand-over stamps are empty and its held receipt is dropped. A value sent for a column the move empties is refused with `STATE_MOVE_REFUSED` (`details.clears`). The same columns changed on their own stay locked. `clears` is allowed only on an undo, and only for columns that may be empty and that no other rule writes. The dashboard's Undo of a hand-over that filled such a column from empty makes the move back.
