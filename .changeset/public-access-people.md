---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/public-client': patch
'@adminium/i18n': patch
---

**An app's guests can find themselves, prove it by email, and see only their own rows.**

- An app declares one **identity** per key (a patient found by mobile and date of birth); its other
  endpoints open that person's own rows, at the level each asks: found (`lookup`) or proved by a
  six-digit **code emailed** to them (`verified`). Codes last 10 minutes and take 5 tries; the
  requests and wrong tries are limited per session and per person; a person locked out by wrong
  tries is shown to the desk, which can lift it (`GET`/`DELETE
  /api/v1/data/:connectionId/:table/:recordId/claim-lock`). A person with a fresh code may change
  their address; the old address is told, and every session of theirs ends.
- A signed-in person may hold only so many open rows (`PUBLIC_LIMIT_REACHED`), and a create can say
  where the new row stands (a waiting-list place).
- A **human check** (a small proof of work) can guard a stranger's create and every claim.
- A stranger's create can be limited per phone number or address a day and per key an hour, with
  names held to plain text.
- Writes can be switched off from the app's settings row (`PUBLIC_SWITCHED_OFF`).
- Email sign-in codes sent through an app's own key are signed with the app's name for its venue.

`@adminium/public-client` gains `requestCode()`, `verifyCode()`, `session()`, `solveChallenge()`
with a `humanCheck` option that answers the server, `createWithRank()`, and the new error codes.
