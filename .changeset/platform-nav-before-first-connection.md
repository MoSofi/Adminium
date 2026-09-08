---
'@adminium/dashboard': patch
---

The sidebar's platform tail no longer waits for a database. With no `nav.groups`
the rail rendered the "Pages appear here once a database is connected" prompt
and returned, which skipped the platform-only groups entirely — so on a fresh
instance Team, Roles & permissions, API keys, the audit log, Files, Email
templates, imports, exports and scheduled reports were all invisible until a
source was connected, which none of them need. Inviting people is the first
thing an admin does, and Team was behind that wall.

The prompt now says only what it means — an explanation for the missing pages —
and renders alongside the tail rather than instead of it. The admin gate is
unchanged: a viewer still sees only the ungated rows.
