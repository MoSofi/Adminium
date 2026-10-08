---
'@adminium/server': patch
'@adminium/llm': patch
---

A model connection whose address is a name is now called at the address that was checked when the name was resolved, so a name that answers differently a moment later gains nothing. The live Designer writes its kept-disk mark in `apps/` as well as `.adminium/`: a host that keeps one folder and not the other is found at the next start, and the switch goes off and says why.
