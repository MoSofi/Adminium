---
'@adminium/server': patch
---

An automation's email step now shows what its template needs. A template is written once and a rule can send it about any table, so `{{first_name}}` went out as written from a table whose column is `name`, with a green run and nothing to say why. Picking a template now lists every placeholder it reads and what fills each one — this record, the rule, or nothing — and one the record does not fill can be filled from a column or a text typed for it, kept on the step. Saving or switching on a rule that would still send one as written warns and opens that step, the Test button says so before anything is sent, and the run's log line names every placeholder that went out unfilled. A template that belongs to an app is marked, since that app's own sender is what fills it. A record's dates and money now read in the mail as a person writes them, in the template's language and the connection's time zone and currency, where the stored value used to be printed.
