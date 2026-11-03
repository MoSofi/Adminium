---
'@adminium/server': patch
'@adminium/i18n': patch
---

A forms builder can show the form a stranger would see while it is still a draft: `/x/forms/<slug>?preview=1` (and its read, `/x/forms/api/<slug>?preview=1`) draws the saved draft, whatever the form's state, for a signed-in person who may read the add-on's forms; anyone else gets exactly the "not available" a stranger gets. A half-made draft is drawn leniently: a word missing in one of its languages is taken from the default language, and a question that does not read yet is left out and named in `skipped`. The preview may be framed by the server's own host alone (`frame-ancestors 'self'`), is never cached or indexed, and is not held to whether strangers can reach the pages. Nothing is sent from it: Send is off, under it "Nothing is sent from here." (in eight languages), and its human check, answer and file routes refuse a preview request and write nothing.
