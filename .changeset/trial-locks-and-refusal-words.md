---
'@adminium/dashboard': patch
'@adminium/widgets': patch
'@adminium/i18n': patch
'@adminium/server': patch
---

The trial's read-only states now reach every write a page draws. Once a trial has ended, a board's "+" and "New card", its composer and card moves, a calendar's "New event", "Add event" and a click on an empty day, a record page's related "New row" and its attachments' upload and Delete, a project's own actions and an app's row buttons, and a list's bulk actions (Delete included) stay reachable but off, with the reason in their tooltip. A database held by the size cap locks only its creates and edits the same way, and keeps its deletes open; the page's create and edit capabilities no longer fold the hold in, so its buttons show, locked, instead of disappearing. A refusal the operator's switches cause (`OFF_BY_OPERATOR`) and the installation's connection-test limit are said in the person's language on every screen, not in the server's English. A Supabase hand-off the instance refused now says "Supabase connection expired." with "Connect Supabase again", and Figma in a trial says the operator switched it off rather than that network features are off.
