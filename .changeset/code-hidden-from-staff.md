---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
---

An app can keep a shared link's code from its staff: `code: { …, "hiddenFromStaff": true }`. A kitchen member could open any online order's link from the staff screens, read the diner's details until 30 days after pickup and cancel "as the diner". The code is now left out of every staff read — rows, exports, live updates and the history — for every role, Super Admin too, while the link still opens its order and the order's own emails still carry it to the diner.
