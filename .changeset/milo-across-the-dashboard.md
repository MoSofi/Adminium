---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/meta': patch
'@adminium/llm': patch
'@adminium/i18n': patch
'@adminium/widgets': patch
'@adminium/ui': patch
---

The assistant is on every page of the dashboard, as a panel docked at the end edge. It opens from a bubble in the corner, from the Ask button in a page's header, or with Ctrl/⌘ + . and stays open from page to page and after a reload. A person has one conversation; every question is asked on the page they are on and the thread says which.

On a page that shows a table's rows (a grid, a record, a board, a calendar, a dashboard) it answers questions about the data in words, with the figures. It knows what the page is showing: the search, the sort, the filters, the ticked rows, the open record, so "these" means what is on screen. Under an answer stand the tables it read, a line when only a part of a table was read, and a line when nothing was read. It reads as the signed-in person: a table, a column or a page their role cannot open is not read for them, and personal columns never reach the model. It only reads; it changes no row and no page.

On any other screen it answers about the workspace and says where things are done, with a link, naming only places that person can open. When what was asked for needs an add-on that is not installed, it shows the add-on's card from the catalogue, with the way to it for someone who may install and "ask an administrator" for anyone else.

On the pages that draft documents (email templates, reports, automation rules) the draft is in the panel with the page's own preview and the same locks and confirmation as before. A draft is usable on the page, and for an editor the document, it was made for; anywhere else it is a small card with the way back. The window that opened over those pages is gone.

Settings → AI gains "Test" for the assistant (it checks that the model can follow the assistant's replies, which a connection test does not) and a daily allowance of tokens per person, with today's use. A person over it is told when it starts again. One question at a time per person.

A list can be ordered by a count or a sum over related rows (`order=<alias>` of an `agg=` or `compute=` figure), with rows that have no value last on every engine, up to 20,000 rows under the filters on SQLite and 200,000 on PostgreSQL and MySQL.

Fixes on the way: a conversation's history was sent to the model again with every turn, growing quadratically; a model that answers with its own tool calls gets a second chance instead of a provider error; an automation rule drafted by the assistant is checked against what its author may read.
