---
'@adminium/server': patch
---

For testing an add-on that finds companies end to end: `ADMINIUM_LEAD_SOURCE_DEMO` names add-ons whose sources are answered with made-up companies and people instead of their own code, with the switch, the key, the caps and Stop still asked as always. While it is on, a found demo person's mail is delivered to the test's mail server (their `.example` addresses are otherwise never written to), so a test can follow its Object link. It works only on a server that says it is for tests: the server refuses to start with it unless `NODE_ENV` is `test` or `development`, and on a trial or a hosted server whatever `NODE_ENV` says, and it logs a warning at every start while it is on.
