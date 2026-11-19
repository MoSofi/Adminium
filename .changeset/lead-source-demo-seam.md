---
'@adminium/server': patch
---

For testing an add-on that finds companies end to end: `ADMINIUM_LEAD_SOURCE_DEMO` names add-ons whose sources are answered with made-up companies and people instead of their own code, with the switch, the key, the caps and Stop still asked as always. While it is on, a found demo person's mail is delivered to the test's mail server (their `.example` addresses are otherwise never written to), so a test can follow its Object link. The server refuses to start with it in production (`NODE_ENV=production`), on a trial or on a hosted server.
