---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

The Designer reads a screen for a React hook called after the component may already have returned (an `if (loading) return …` above a `useEffect`). Such a screen builds and then stops as it opens; the model is now told the file, both lines and what to move, by `check_app` and before the turn ends, so a person does not meet the error first.

Two more of the same kind: a screen that reads its table names from the public client's own config (which has none) is told so; and the preview now shows an error a screen went on from (a list left empty because its load threw), with "Ask the Designer to fix it", where it used to show only an error that left the page blank.
