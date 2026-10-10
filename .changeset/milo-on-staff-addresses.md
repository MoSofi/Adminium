---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

The assistant has a button on an app's own staff screens, opened by themselves at `/apps/<key>/staff/` or on a domain attached to that side. A signed-in person whose role may use the assistant gets it in the bottom corner; the first press opens the same panel as in the dashboard, as the general assistant with the app named. It is the same assistant: the same permission, the same limits on what a role reads, the same switches, allowance and confirmation.

The customer side of an app never has it. Nobody signed out sees it. Inside the dashboard, where an app's staff screens are framed, the dashboard's own button serves.

Settings → AI has a switch, "On your apps' staff addresses", on by default: off keeps the assistant in the dashboard without touching roles.

A person whose roles are all screens-only reaches the assistant only when an administrator has given their role the assistant permission (no role has it by default, and an app's manifest cannot grant it). They can ask about their app's data and where things are done; the conversations of the dashboard's document pages are not opened for them.

A file of the dashboard's build that does not exist now answers 404 instead of the dashboard's page.
