---
'@adminium/dashboard': patch
'@adminium/adapter-postgres': patch
---

Setting up is smoother. Pressing Continue right after pasting a connection string moves on once the string has been checked, instead of doing nothing until you press it a second time. If the check finds an Adminium already in that database, you stay on the step to choose what to do. The connect wizard that follows setup no longer asks again where Adminium keeps its own data: setup has just asked, so it goes from Tables to Enrich. A Postgres table nobody has analysed yet (a new Supabase project's) shows its row count rather than "—".
