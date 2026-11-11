---
'@adminium/server': patch
'@adminium/dashboard': patch
---

An app or add-on update that would let visitors see more through a public endpoint they already use (a column a shop page now reads, say) now asks first. The update's check lists each such endpoint on a **Shows visitors more** card, and **Update** waits until you tick **Allow it**; through the API the update is refused with `PUBLIC_WIDER` unless it sends `"publicWider": true`, and only someone who may manage API keys may allow it. Each widening is written to the audit log. Before, the update went through and quietly left the old endpoint in place, so a release's new public columns never reached an updated server.
