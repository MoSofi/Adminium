---
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

The desktop app's first-run setup now tests a server database's connection string before it creates anything. Before, a string the database refused (a wrong password, or Supabase's pooler user written as `postgres.<ref>` instead of `adminium_rw.<ref>`) was saved anyway, setup went on to Generate, and the app opened on "No pages yet" with only a "Remote DB offline" chip to say something was wrong. Setup now stops at "Adminium could not connect to that database", with the database's own reason and a **Change the connection** button that goes back to the database step (past the account, which already exists) and from there straight on. On Supabase's pooler a refused login also says how the user must be written; Studio's connect wizard says so too. Setup also waits for the schema read to finish instead of moving on while it runs, shows it if it fails, and **Try again** reads the schema again rather than skipping ahead.
