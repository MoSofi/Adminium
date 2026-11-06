---
'@adminium/dashboard': patch
'@adminium/server': patch
'@adminium/i18n': patch
'@adminium/docs': patch
---

Workspaces group a server's databases, one per team or business, and the menu follows them. An administrator chooses one view for everyone: All in one menu, with a folding block per workspace, or One at a time, with a switcher at the top. Each tab keeps its own current workspace, a link to another business's page switches it, and databases in no workspace show under Other databases. Library pages such as automations, files, exports and the audit log follow the view, with a workspace filter and chips. Workspaces are managed on Data connections: create, rename, reorder and delete them, and choose each connection's workspaces. A server with no workspace looks exactly as before. A workspace organises the menu and is not a security wall: roles still decide who sees what, a database shared by two workspaces shows both to whoever reaches it, and server-wide rights reach every business.
