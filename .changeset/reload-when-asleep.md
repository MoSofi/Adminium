---
'@adminium/dashboard': patch
---

The dashboard reloads the page when an API read is answered with a 503 that carries `X-Aapp-Asleep: 1`, the answer an operator's proxy gives for an instance it has put to sleep and wakes only when a page is opened. A person who comes back to an old tab gets their app back after the proxy's waking page instead of a page that stops answering. A save that gets that answer does not reload, so what the person typed stays on the page. It reloads at most once in 30 seconds, so it never loops. No other answer does anything new.
