---
'@adminium/widgets': patch
'@adminium/engine': patch
---

A generated list now always shows the table's name column, first. A name kept as Postgres `text` with no length (a Lovable or Supabase app's `cakes.name`, `orders.customer_name`, `profiles.full_name`) was classed as long text and left out, so the Cakes list showed prices and no cake names. Other long-text columns stay out of the list as before. Pages generated before and not changed since pick the column up the next time they are regenerated.
