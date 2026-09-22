---
'@adminium/meta': patch
'@adminium/server': patch
---

**On a Postgres or MySQL meta store, a workspace or assistant name that looks
like a number now stays a name.**

A name setting whose text is also valid JSON, such as `2048`, `true`, `null`
or `[1]`, came back from these stores as a number, boolean, null or array. It
then failed its own check on every read:

- **An assistant named `42` broke the dashboard.** The first request after
  sign-in failed, so no page loaded.
- **A workspace named `2048` broke every branding read**, including the
  sign-in page's. Renaming it did not help either, because the rename reads
  the current name first and failed the same way.
- **An exported configuration carried the name as a number**, so the instance
  importing it skipped the setting.

A name in quotes, such as `"Acme"`, silently lost its quotes.

SQLite was never affected, which is why every local test passed. Settings
now read back exactly as they were written on every store.
