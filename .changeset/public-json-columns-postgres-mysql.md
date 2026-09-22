---
'@adminium/meta': patch
'@adminium/server': patch
---

**On a Postgres or MySQL meta store, a key's allowed origins and a customer's
claimed session now work.**

Postgres and MySQL return a JSON column already parsed, and SQLite returns
the text it stored. The public API read two such columns expecting text, and
on the two production stores both reads failed:

- **A key limited to certain origins accepted every origin** on the
  instance's `ADMINIUM_PUBLIC_API_ORIGINS` list. The key's own list was
  dropped, so it was narrowed by nothing.
- **A customer who had claimed their records was treated as not signed in.**
  Everything behind a claim answered 404 for them.

SQLite was never affected, which is why every local test passed. Both
columns now read back as text on every store, the same fix the scope document
got earlier.

This release also adds meta migration `0038_public_endpoints`. It creates
three new tables and adds nullable or defaulted columns to publishable keys and
scopes, so existing rows are unchanged. Nothing uses them yet; they are for the
coming endpoint builder on the API keys page.
