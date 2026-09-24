---
'@adminium/widgets': patch
'@adminium/engine': patch
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/meta': patch
---

**Dashboard cards speak the page's language and lead somewhere.**

- A KPI card with a link is one button that opens it; nine new icons for front-desk cards.
- A chart grouped by a link names each group by the row it points at ("Dr Rao", not 7), under
  your read and masking; a choice column's groups and record-list cells use its labels.
- Money cards use the connection's currency unless they name their own.
- A dashboard can end its day controls with one link ("Open the desk").
- Card titles can carry translations, picked by the page's language.
- A choice column's value labels an app ships in several languages are read in each person's own:
  a status pill, a chart legend and a form's choices say "Wartend" to a German reader and
  "Waiting" to an English one. A card that lists its own columns takes them from the answer too.
  Labels installed before stay as they were until the app is updated. A page's list, record,
  master-detail, queue and calendar say them too, as do the words of an inline list of allowed
  values in the form, the filters and the list; a page that names its own words keeps them.
