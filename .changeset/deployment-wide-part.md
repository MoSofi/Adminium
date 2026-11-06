---
'@adminium/dashboard': patch
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

An app file can carry the server's look and words: the logo and colours, which languages are on, changed wording, edited system emails and a few plain settings, never a setting that holds a secret. It is left out unless ticked when saving. On the new server it is applied only when someone who manages server settings ticks Also apply the look and languages, with each edited email's links ticked one by one, all in one step. The app's page then says what it changed, and Undo puts back what was there before, leaving alone anything someone changed since.
