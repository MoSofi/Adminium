---
'@adminium/server': patch
'@adminium/dashboard': patch
---

"Can visitors reach your public pages?" now says when it cannot tell whether visitors come through a proxy. `GET /api/v1/privacy/reach` and `GET /api/v1/forms/status` add `proxyUnchecked`: true while no proxy is trusted and the request came with no forwarding header. Staff who open the dashboard directly saw "Reachable" while visitors coming through a proxy the server does not trust were told "not available". The Privacy page now shows a line under "Reachable" in that case, and the reverse-proxy guide says what to set.
