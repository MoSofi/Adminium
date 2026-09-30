---
'@adminium/server': patch
---

A record's history is now readable by whoever reads the record: `GET /api/v1/data/{connectionId}/{table}/{recordId}/history` answers its own changes from the audit log, newest first and in pages, without the columns the reader's role does not read and without the address, browser or request they came from. An app's roles can never be given the audit page's `system:audit:read`, so a box office's order timeline had to be pieced together from the row's own stamps.
