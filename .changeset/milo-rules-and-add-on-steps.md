---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/meta': patch
'@adminium/llm': patch
'@adminium/manifest': patch
'@adminium/add-on-contracts': patch
'@adminium/i18n': patch
---

Automations reach one row further, and say what to write when a value is missing. A rule can name a column of the row its record links to (`customer_id.email`): as an email's recipient, and as a placeholder. A placeholder can carry a backup (`{{first_name|there}}`), written when the value is not there; an email block can be tied to a value (shown only when it is there, with other words in its place for a text or a heading). The email editor draws each placeholder as a chip that asks for its backup, has a Visibility section on every block, and previews the email as a reader with no values is sent it.

An installed add-on can give Automations a step. The add-on's manifest says what the step is called, what a person fills in, and the one row of its own table the step makes (`addOn.steps`); the builder offers it under "From add-ons", and a rule runs it through the same write as "create a record", so the add-on's own rules, mails and events follow. A rule keeps a step whose add-on was removed and says which add-on it lost. A personal column of the record may be read only for an input the add-on itself keeps personal, and is never written to a run's log. A rule that holds such a step is checked again when it is switched on.

An add-on can also say what its tables are, in one line each, and offer questions for its own pages (`addOn.assistant`). The assistant reads the lines when it describes a table and shows the questions on the add-on's pages. An add-on cannot give the assistant a tool, switch anything on, or widen what a person reads.

On Automations the assistant drafts a whole rule: it looks up the live templates, the address columns, the roles and the steps add-ons give before it drafts, and says what it left out. The draft's card is drawn by the builder itself. With a rule open, a change is put into that rule's unsaved draft ("Apply to this rule"), marked, and undone with one click; nothing is saved until the person saves.

Manifests that use the new words need Adminium 0.3.22 or later.
