---
'@adminium/add-on-contracts': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

A forms vocabulary at `@adminium/add-on-contracts/forms` (and in the package index): a form's definition (eleven question kinds, "show if" on an earlier answer, sections, a version of every text per form language, the agreement tick with its wording's version and purpose, the hidden source field, the ending) and its settings (what an answer becomes, who is told, the hourly cap and a harder check, a survey's named or anonymous mode). `parseForm` reads both and refuses with codes, not sentences; `checkAnswer` holds an answer to its form (only shown questions, each kind's own bounds, a hidden field from the page address alone, text NFC-normalised without control characters); `visibleQuestions` says what a visitor is shown; `summarise` counts results per choice, score and star, with the recommend score and the stars' average, across languages.
The add-on block takes a `forms` word naming the add-on's tables, checked whole by `@adminium/manifest`, and add-ons have a new category, `marketing`, labelled in the add-on browser in all eight languages.
