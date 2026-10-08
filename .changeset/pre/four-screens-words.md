---
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

The dashboard's first load is about 5.5 KiB smaller: the English text of the dashboard builder, the knowledge base, About and Team now loads just after the first paint instead of with it. Fixed: with a widget text and a page-template text both reworded in Translations, the other texts of those two groups stayed on the English written in the code for the rest of the session.
