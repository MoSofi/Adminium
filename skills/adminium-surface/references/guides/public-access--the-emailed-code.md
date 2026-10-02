<!-- produced from apps/docs/src/content/docs/guides/apps/public-access.md § The emailed code; do not edit -->

# An app's public access: The emailed code

Knowing a person's details is not the same as being them. When the identity sends a code, a found
session asks for one, and the person types it back:

```bash
# Ask for a code, with the session header of a found session
curl -X POST https://admin.example.com/api/v1/public/claim/code \
  -H "Authorization: Bearer $ADMINIUM_KEY" -H "x-adminium-public-session: $SESSION" \
  -H 'content-type: application/json' -d '{"purpose":"verify"}'
# → { "data": { "sentTo": "a•••@e•••.com", "resendAfter": 30, "expiresAt": … } }

# Type it back
curl -X POST https://admin.example.com/api/v1/public/claim/verify \
  -H "Authorization: Bearer $ADMINIUM_KEY" -H "x-adminium-public-session: $SESSION" \
  -H 'content-type: application/json' -d '{"purpose":"verify","code":"482913"}'
# → { "data": { "level": "verified", "expiresAt": … } }
```

- **The code** is six digits, works for 10 minutes and allows 5 tries. The fifth wrong try ends
  it, and asking for a new one replaces the old. It is sent to the address on the person's row,
  never to one the page supplies, with the built-in **Sign-in code** email in the visitor's
  language, signed with the app's name. Adminium keeps only a keyed hash of it.
- **The address is shown masked**: its first letter and the domain's, such as `a•••@e•••.com`.
  For the large mail providers the domain is shown whole, such as `b•••@gmail.com`.
- **The right code** raises the session to verified for 30 minutes.

| Answer | Status | When |
|---|---|---|
| `PUBLIC_CODE_WRONG` | 403 | Not the code. `params.triesLeft` says how many tries remain. |
| `PUBLIC_CODE_EXPIRED` | 410 | No code is open: expired, used, replaced, or ended by wrong tries. |
| `PUBLIC_CODE_TOO_SOON` | 429 | A code went less than 30 seconds ago. `params.retryAfter` in seconds. |
| `PUBLIC_CODE_LIMIT` | 429 | This session has had 5 codes. |
| `PUBLIC_CODE_LOCKED` | 429 | The session's last code died of wrong tries; it waits 15 minutes. `params.retryAfter`. |
| `PUBLIC_CLAIM_LOCKED` | 403 | Too many wrong tries for this person today. |
| `PUBLIC_CLAIM_NO_EMAIL` | 409 | The person has no address on file. The page says to ring. |
| `PUBLIC_CODE_UNAVAILABLE` | 503 | Email cannot be sent from this server. No code is left open. |

**Limits per person.** The person is their row, whichever page, key or session asks. Each person
gets at most 3 codes in 15 minutes and 10 a day. Past that the answer looks the same but nothing
is sent, so a stranger learns nothing from it. After 10 wrong tries in a day the person is locked
for every session, new ones included, and the lock lifts within 24 hours of those tries. The
desk can lift it sooner, once they have checked who is asking: `GET
/api/v1/data/<connection>/<table>/<id>/claim-lock` says whether the person is locked and how many
wrong tries there were, and `DELETE` on the same address lifts it (it needs the right to change
that table, and is audited).

Because the code proves the mailbox, the public API can never write the columns a claim matches
on or the address the code goes to, nor create rows in the identity table. The address changes
only this way:

1. From a verified session that confirmed a code in the last 10 minutes (else `403`
   `PUBLIC_CODE_STEP_UP`, or `PUBLIC_CLAIM_LEVEL` for a lookup session), ask with `{"purpose":"email-change","email":"new@example.net"}`. An
   address that is not one, or is the same, is refused `400` `PUBLIC_WRITE_REFUSED`.
2. The code goes to the **new** address. Confirm it with `{"purpose":"email-change","code":…}`.
3. The row's address is changed, and the **old** address gets the built-in **Email address
   changed** notice, even if that template is switched off. When the app's outbox names a
   `phone` column of its settings row and that row holds a number, the notice ends "If this
   wasn’t you, ring us on" that number, in the recipient's language; otherwise it asks them to
   contact you straight away.
4. **Every session of that person ends**, this one too: the reply says so, and the page starts
   again from the details.

An address can change once per person a day (`429` `PUBLIC_EMAIL_CHANGE_LIMIT`). With email not
set up, nothing is changed and the answer is `503` `PUBLIC_CODE_UNAVAILABLE`.
