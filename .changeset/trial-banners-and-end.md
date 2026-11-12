---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/widgets': patch
'@adminium/i18n': patch
---

A trial installation now says so on every page. Two strips sit under the top bar, and above the sign-in and setup screens: "This is a test environment. Please don’t put real customer data in." (the whole sentence on every width, wrapping on a phone) and "N days left · Export everything", with "Upgrade" when the operator set `ADMINIUM_TRIAL_UPGRADE_URL`. Neither can be closed. Upgrade opens the operator's page in the same tab, and also sits in the user menu (in one group with "Put this online…", after the Studio group) and on the Export everything page. Once `ADMINIUM_TRIAL_ENDS_AT` has passed, one strip says "This trial has ended." with Export everything and Upgrade, page titles carry a "Read-only" chip, and the create, edit, delete and save buttons of data pages stay reachable but off, with "Read-only: this trial has ended" in their tooltip. The server then refuses every write with 403 `OFF_BY_OPERATOR` except signing in and out, a forgotten password, the first-run setup, the exports and the reads a page sends as a POST; it answers 404 at every public page (forms, the mail door, pay pages, the public API and its docs, customer sides and the domains mapped to them); and it queues no user mail, while password resets, invitations and sign-in codes still go out. An app's queued emails wait in its outbox. Nothing changes outside trial mode or before the end date.
