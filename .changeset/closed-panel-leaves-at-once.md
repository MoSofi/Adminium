---
'@adminium/ui': patch
---

A closed list, popover, menu or tooltip now leaves the page at once. Radix keeps a closed panel mounted while it thinks an exit animation runs, and because a panel's entrance is held back until it is placed, the entrance could be taken for one: the closed panel then stayed on top for a moment, and the next Escape closed it instead of the sheet or dialog under it (a rule step's settings stayed open after picking a survey). None of these panels has an exit animation, so a closed one now drops its animation and is gone in the same frame.
