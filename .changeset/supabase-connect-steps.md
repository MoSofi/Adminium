---
'@adminium/docs': patch
---

The Postgres guide has a "Supabase, step by step" section: the role, `BYPASSRLS`, and the session pooler string with the user written `adminium_rw.<project-ref>` (with the role name alone the login fails). It also says the direct connection is IPv6-only unless you buy Supabase's IPv4 add-on, and that an app on Lovable Cloud has no connection string. The `auth.users` grant is now marked as one that does nothing on hosted Supabase: the SQL editor says "Success" while Postgres skips it. The guide gives the query that shows what the role really has.
