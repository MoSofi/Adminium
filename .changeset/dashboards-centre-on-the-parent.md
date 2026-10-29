---
'@adminium/widgets': patch
'@adminium/engine': patch
---

A generated dashboard is now built around the right table when the schema has line items. An `order_items` table links to both `orders` and a catalogue (`cakes`), so it won the hub by link count: the dashboard was called "Order Items Dashboard", added up unit prices, counted "New Cakes" and charted cake prices per month. A line-items table is no longer a hub; the table it cascades from is. A money total no longer reads "Total Total": a column already called a total keeps its name, and one called just "Total" is "Total Value", on dashboards and boards alike. Money totals on generated dashboards now show their currency (the card's format was set under a key it does not read).
