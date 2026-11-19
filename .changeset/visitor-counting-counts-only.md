---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

Adminium now counts how many times strangers see your landing pages and forms, and this is switched on for every install at "Counts only". It sets no cookie and keeps nothing about the visitor: only a number per page or form per day, with known bots and prefetches left out and a repeat view of the same page from one address within half an hour counted once. Counts are kept 13 months by default, then removed. You can see the setting, and turn it Off, under Privacy → Visitor counting; mention it in your privacy notice if you keep it on.

A form counts when its page is read, when a form block on a landing page comes into view, and when an answer is kept. Staff who may read a form's or a page's table see its counts through `GET /api/v1/views`. The level and the banner's words are read and changed with `GET` and `PUT /api/v1/privacy/counting`, and how long counts and visits are kept with `PUT /api/v1/privacy/keeping`; both appear as two new rows under Privacy → Keeping. The counts are kept in two new meta tables, added by migrations 0096 and 0097.
