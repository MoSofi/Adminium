---
'@adminium/manifest': patch
'@adminium/server': patch
---

A table an app opens to forms may name the column a form's fixed "Source" value goes into: `source` on its entry under the key `forms` (from Adminium 0.3.41, the floor word `publicAccess.forms.source`), one of the entry's `writable` text columns, never a link; it is refused on any other entry. A forms add-on's settings table, when it has the `answers_months` column the keeping sweep reads, holds it as a whole number that may be empty (`int`, nullable). The words a step about a person needs are named with their floor too (`step.person`, `step.recordBy`, `step.recordWhere`, `step.help`, `step.recordTokens`, all 0.3.41).
