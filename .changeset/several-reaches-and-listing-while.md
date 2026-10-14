---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
---

A role's read, update or delete of a table may name several reaches, any one of them enough: an account manager reads every won deal, and an open deal only while he is listed on it (`"rows": { "read": [{ "reach": "all", "while": { "column": "state", "in": ["won"] } }, { "reach": "own" }] }`). Each reach is its own whole test, as two roles' are. A listing a table is read `through` may count only while a column of it holds some values, or is empty (`"while": { "column": "ended_on", "isNull": true }`): a member row whose end is filled in lists nobody, at once, on every read, and a dashboard figure kept for a moment is dropped when the listing changes. A row hung under its parent (a deal's comment) is hung only under a parent the writer's own reach of that table reaches: the account manager comments on a deal he is on, and on no other won deal he reads (403, reason `parent-not-theirs`). The role editor shows several reaches in words, keeps them through a save, and says when a listing counts. Both words need Adminium 0.3.28.
