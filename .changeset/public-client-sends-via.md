---
'@adminium/public-client': patch
---

`client.list(ref, { via })` now sends its filter. A shop that filtered products through their variants (a colour and a size on one variant) used to get every product back with no error, because the client dropped `via` from the request. A list that declares no `via` in `manifest/access.json` now answers 400 `PUBLIC_QUERY_REFUSED` to such a call instead of ignoring it.
