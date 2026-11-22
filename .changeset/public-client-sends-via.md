---
'@adminium/public-client': patch
---

`client.list(ref, { via })` sends its filter, so a shop can filter products through their variants (a colour and a size on one variant). A list that declares no `via` in `manifest/access.json` answers 400 `PUBLIC_QUERY_REFUSED` to such a call.
