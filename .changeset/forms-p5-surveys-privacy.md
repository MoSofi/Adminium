---
'@adminium/manifest': patch
'@adminium/add-on-contracts': patch
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

An outbox kind may name a consent purpose (`outbox.purposes`: `newsletter` or `surveys`). A marketing kind is judged by the consent log's answer for that purpose instead of the newsletter's; a service kind that names one still reaches the do-not-email list but skips a person whose latest answer for it is "no", when it is queued and again at the hand-over. A forms add-on with invitations may name the kinds whose template prints `{{survey_link}}` (`outbox.surveyLinks`, every producer reading the invitations table): Adminium fills it when the mail goes, with a one-use token for a named survey (the invitation keeps only its SHA-256 and when it stops, `invited_at` plus the survey's days), the open link for an anonymous one, and skips the mail with the reason when the invitation is answered or past its days, the survey is not live, or the server has no public address. Both words need Adminium 0.3.40.
`GET /api/v1/add-ons/:key/forms/:id/summary` counts a form's answers (all of them, a page at a time) with the forms vocabulary's summary, plus how many were invited and answered, under the reader's grant on the answers table. The data kit offers it as `useFormSummary(formId)`, and `useFormTables()` lists the tables an app opens to forms (the kit's `via: 'forms'` hosts, with their writable columns and which are links); a page never reads those tables.
A person's data now searches, downloads and erases every forms add-on's answers given by the address (a waiting sign-up included; the CSV writes each question under its label) and lists the invitations sent to it; erasing deletes the answers and empties the invitations' address and name. "How long we keep things" shows each forms add-on's answers row, read from its settings table's `answers_months`, and a nightly sweep deletes older answers.
