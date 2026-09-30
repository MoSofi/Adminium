---
'@adminium/server': patch
---

A bulk change or delete now reaches the screens watching the table: each row goes out as a row's own change does, on the channel a board or a kitchen's screen listens to. Before, a manager's bulk menu edit was announced on a channel no browser could subscribe to, so the kitchen's board never saw it; an undo is announced where screens listen too, and nothing is published on the unused `table:` channel any more.
