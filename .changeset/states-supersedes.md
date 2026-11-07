---
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
---

A new row can move the earlier rows of its table that share one of its links: `"supersedes": { "by": "<link>", "from": [<states>], "to": "<state>" }` under `states` (Adminium 0.3.50). A proof sent again for an order line moves the line's earlier proof still waiting, or with a change asked, to superseded, whichever door made the new one: a staff screen, the data API, a save of several rows, a guest's write, a rule or a project's code. Each earlier row moves by the table's own listed move, in the same write as the new row: a refused move refuses the create, and two rows made for one line at the same moment take their turns. Importing rows and sample data keep the state each row was in.
