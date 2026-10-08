<!-- produced from apps/docs/src/content/docs/guides/add-ons/inventory.md § Places, stock and batches; do not edit -->

# The Inventory add-on: Places, stock and batches

- A **place** is where stock is kept: a shop floor, a back room, a van. A place that does not count
  as available ("At the laundry", "Damaged") holds stock that nobody can sell or use from.
- **Stock by place** has one row for an item in a place: on hand, held, on order, available, its
  reorder level and the quantity to reorder. The state beside it reads In stock, Low, On order or Out.
- An item **kept in batches** has a level for each batch in each place, with the batch's code and
  the day it expires. Stock is taken from the batch that expires first. A batch past its date is
  passed over: when nothing else is left, the save is told the stock has expired.
- Every change is a **movement**: received, sold, used, moved, written off, a count difference.
  Movements are never edited. A mistake is undone by a second movement that says so.

Costs are a moving average for each item: a receipt at a new cost moves the average, a use takes
stock out at the average of that moment.
