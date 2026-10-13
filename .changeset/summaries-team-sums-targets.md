---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

A summary's section can read the rows of the people its reader leads (`"reach": "team"`), add columns up over every row (`sum`), list a line a person (`"by": "owner"`) and measure a sum against a target (`target`). Each is read as the person the summary is for, when it is sent: a figure their role cannot answer is left out, never zero. A summary says when its figures were read; a signed-in person can ask for their own with `POST /api/v1/me/summaries/{ruleId}/send`, three times an hour; and a summary job can no longer be queued by hand. Needs Adminium 0.3.28.
