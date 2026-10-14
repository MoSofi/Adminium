---
'@adminium/server': patch
'@adminium/meta': patch
---

A rule now tells each person only what that person reads. A notice to a role or to a lead is written for each reader: a column their role is not shown is empty in theirs, as it was too. The person a staff column names is told and mailed only when they can open the record (else the step's other roles are told, or the run says nobody was), and a mail to them carries a personal column only if they are shown it; a step's own `recordUrl` no longer replaces the record's address. An amount read from a setting is no longer a way to read a table: the rule's author must read the table it is kept in (and one whose rows a condition counts), a secret or personal column and a private table are refused, and a run reads it from the row with the lowest key, as a rule reads the connection. A run keeps only the columns of the record as it was that its rule reads, never a secret one, and lets go of them when its job gives up. A co-lead of somebody's own team is no longer told as their lead.
