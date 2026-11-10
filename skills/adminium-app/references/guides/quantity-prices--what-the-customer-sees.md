<!-- produced from apps/docs/src/content/docs/guides/apps/quantity-prices.md § What the customer sees; do not edit -->

# Prices by quantity, sheets and weight: What the customer sees

A quote (`dryRun`) picks the bands and works out the formulas exactly as the save does, so the price
a basket shows before checkout is the price the order stores. Ask for a quote whenever the customer
changes a quantity, and show what it returns; never work a price out in the browser.

Every figure is exact: values are read as exact fractions, never as floating-point numbers, so a
line is the same on PostgreSQL, MySQL and SQLite to the last cent.
