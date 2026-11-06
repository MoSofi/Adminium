---
'@adminium/dashboard': patch
'@adminium/server': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

Email templates, campaigns and report layouts can be shown in chosen workspaces only. Shown in, at the end of the email editor's Brand & sender panel and the report builder's header panel, lists the item in all workspaces (the default) or only the ones you tick, and the lists gain a Shown in column and a workspace filter. It narrows lists and pickers, never sending: a rule that already uses a template keeps sending it. Deleting a workspace lists the items shown there alone, and they stay listed nowhere rather than everywhere. Invoice layouts take the same setting through the API.
