---
title: An app's public access
description: What an app's customer screens may do through the public API, the keys the install makes for them, how guests find their own rows and confirm who they are, the checks on strangers, a kiosk, and what switches it off.
---

An app's **customer screens** are public pages: a booking form, a menu, a guest's own reservation.
They have no signed-in user, so they read and write your database through the
[public API](/guides/public-api/endpoints-and-keys/), with a browser key the install makes for them.
This page covers the app's keys and their endpoints. Everything else about the public API applies
to them unchanged.

## What the install shows first

When an app has customer screens, the table check has a **Public access** card: "The app's
customer screens need to:", then one line per thing they will do, for example:

- **Read** *table*, or **Add to** *table*, or **Change** *table*;
- **Read free or full times of** *table*;
- **Look up their own** *table* **by** *fields*;
- **Add to** *table*, **and get a confirmation email**.

**Allow this public access** is ticked by default, because the customer screens do not work
without it. Untick it and the app installs with no keys and no endpoints. **You can narrow it
later on the API keys page.**

Allowing it needs the **Manage API keys** permission as well. Someone without it sees the box
switched off and the line "Only someone who may manage API keys can allow it, so the app installs
without it."

The card also warns about anything that would stop the keys working, though the install still
goes ahead:

| Warning | What to do |
|---|---|
| The public API is switched off | Turn on **Public API** in **Workspace settings** |
| The allowed origins do not include "self" | Add `self` to `ADMINIUM_PUBLIC_API_ORIGINS` and restart ([below](#origins)) |
| This database has no time zone set | Set the connection's time zone; dates and times need it |
| Email is not set up | Set up email, or guests get no confirmation, no reminder and no emailed code |

## What the install makes

For each line, one public endpoint on the app's real table:

- **A records endpoint**, named after the table, with the methods the app asked for. It exposes
  the columns the app lists, or else every column it declares for that table, and the writable
  columns and fixed filters the app names. It returns 50 rows by default and at most 200.
- **An availability endpoint**, named *table*`_availability`, when the app takes bookings against
  a limit per time slot or a [booking rule](/guides/apps/booking-rules/). It answers only whether
  each time is **free** or **full**, and never returns a row, a name or a count. See
  [Free or full](/guides/public-api/endpoints-and-keys/#free-or-full).
- **A claim endpoint**, named *table*`_claimed`, when guests look up their own row, and one for
  each table of [a person's own rows](#a-persons-own-rows): *table*`_claimed`, or
  *table*`_verified` when it needs a [confirmed code](#the-emailed-code).

Then one browser key per key the app declares, granting exactly its endpoints and methods:

- **The guests' key**, named after the app with "· guests" at the end, for the customer screens.
  The customer screens fetch it from the server each time they load, so it never has to be built
  into them.
- **A second key**, when the app declares one, named after the app and the key, such as
  "· kiosk". It serves a staff member's screen; see [A kiosk](#a-kiosk).

Neither is narrowed to any origin.

## Guests finding their own booking

A claim lets a guest open their own row by proving they know its details, for example a booking
code and a mobile number, with no account. The guest must supply **every** field the app declared
and nothing else, and exactly one row must match. A guest who gets it right receives a session for
30 minutes (3 at a [kiosk](#a-kiosk)) that reaches that row, and the rows tied to it, and nothing
else.

Two kinds of field are compared by what they mean, because guests type them from memory:

- **A code** written by a column's code rule is compared the way the rule writes it: upper case,
  spaces removed, the prefix put back, and letters that look like digits read as digits (O as 0,
  I and L as 1). So `mr 4829`, `MR4829` and `4829` all find `MR-4829`.
- **A phone number**, in a column marked as one, is compared by its digits, however it is
  punctuated, and the **whole** number has to agree. A leading `0` trunk prefix and a country code
  the guest left off are allowed for; the last few digits alone never match.

A wrong answer, no match and more than one match all get the same `403` with the code
`PUBLIC_CLAIM_NO_MATCH`. An app can also ask for a [human check](#the-human-check) on every
claim.

## A person's own rows

A key has one **identity**: the table guests claim, such as patients. Other entries can belong to
it. Each reaches only the rows whose column holds the found person's key: their visits, their
place on a waiting list, their own patient record. A session found through another identity
reaches none of them. Without a session they answer `404`, as if there were nothing there.

- **Creating one.** A signed-in create fills the column with the person's key itself; the page
  cannot set it. An entry may also let a create go through with **no** session, such as a first
  visit by someone not yet on file. The app can then name columns that a signed-in create
  empties, such as the name and contact details typed for a first visit, because the person is
  already on file.
- **Two levels.** A session found by details is at the **lookup** level. It reaches the
  **verified** level once the person confirms a code sent to their own address
  ([below](#the-emailed-code)). An entry that needs verified refuses a lookup session with `403`
  and the code `PUBLIC_CLAIM_LEVEL`, and the page asks for the code. On such an entry, a verified
  session also sees its own values in columns marked personal; every other public read keeps them
  masked.
- **Sensitive entries.** An app marks an identity **sensitive** when knowing a person's details
  should not be enough to see their records, as in a clinic. Every entry it opens must then say
  whether it is sensitive too. A sensitive one needs a verified session, and one that is not must
  give a reason. The install refuses an app that leaves either out.
- **What may change.** A guest may change only their own rows, only the columns listed, only to
  the values listed (cancel, never mark a visit seen), and only while the row is in the state the
  app names (booked, and still ahead). Any other row is `404` to the change, though it still lists.
- **Only so many open.** An entry can cap how many open rows one person holds, for example two
  upcoming visits. The next signed-in create is refused `409` with the code
  `PUBLIC_LIMIT_REACHED`, and the page offers the phone instead.
- **Rank.** A create can answer where the new row stands, such as "you are 3rd on the waiting
  list". The reply carries `rank`, the number of matching rows ordered at or before it, and
  nothing else about them.

## The emailed code

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
   changed** notice, even if that template is switched off.
4. **Every session of that person ends**, this one too: the reply says so, and the page starts
   again from the details.

An address can change once per person a day (`429` `PUBLIC_EMAIL_CHANGE_LIMIT`). With email not
set up, nothing is changed and the answer is `503` `PUBLIC_CODE_UNAVAILABLE`.

## The human check

A browser key sits in a page anyone can read, so a script can book as easily as a person. An app
can ask for a small **proof of work** before a stranger's create, and before every claim. The page
asks for a challenge, solves it, and sends the answer with the request:

```bash
curl 'https://admin.example.com/api/v1/public/challenge?purpose=write' -H "Authorization: Bearer $ADMINIUM_KEY"
# → { "data": { "id": "…", "salt": "…", "difficulty": 16, "expiresAt": … } }
# then:  x-adminium-proof: <id>.<nonce>
```

- A challenge is `write` or `claim`, and lasts 2 minutes. Solving it takes about a second on a
  cheap phone. [`@adminiumjs/public-client`](/guides/public-api/endpoints-and-keys/) solves it in
  the background and retries once.
- **One proof, one request.** A proof is spent when it is checked, on every server at once, even
  if the write is then refused. The page solves a new one for the next try.
- **Who is excused:** a person signed in through the key's identity, on an entry that caps their
  open rows; a [kiosk](#a-kiosk); a server key.
- A missing, wrong, expired or used proof gets one answer: `403` `PUBLIC_PROOF_REQUIRED`.
- Several creates in one batch on an entry that asks for a proof are refused whole.

The proof makes each request cost something. It prices out a careless script, not a determined
one: the limits below are what bound abuse.

## Limits on a stranger's create

An app can limit a create that nobody signed in for, such as a first visit booked online:

- **Per phone number or address, a day.** At most so many in 24 hours for one value of the
  columns the app names, whichever page or key it came through. A phone number counts by its last
  nine digits, so `+44 7700 900123` and `07700 900123` are one number; an address counts in lower
  case.
- **Per key, an hour.** At most so many through the key in an hour, from everyone together.
- **Names as plain text.** The columns the app names hold letters, spaces and ordinary
  punctuation only, up to 80 characters: no digits and no link. Anything else is refused `400`
  `PUBLIC_WRITE_REFUSED`, with `params.column` naming the column.

Over a limit, the create is refused `409` `PUBLIC_LIMIT_REACHED` and the page offers the phone.
A create refused for another reason, such as a time taken meanwhile, does not count. Values are
counted as keyed hashes, so the count is never a list of numbers.

## A kiosk

An app can declare a **second key** for a screen your staff set up, such as a tablet where
patients check themselves in. It is not the guests' key: the staff screens hand it only to
someone signed in with the role the app names for it, on the app's database. The **API keys**
page shows it with the badge **Staff screen only**.

That role must be screens-only, with no access but the app's staff screens, because anyone can
walk up to the tablet. Sign the tablet in with a staff account that holds that role.

Every request with the key must come:

- from a live staff sign-in holding exactly that role of that app (never a super-admin, never
  another role);
- from the page itself, on the same origin, and with the dashboard's CSRF token on a write;
- on the app's staff domain, when you mapped one.

Otherwise the answer is `403` `PUBLIC_STAFF_REQUIRED`, whatever the reason, before any limit is
spent. A token copied out of the page opens nothing on its own.

At the kiosk:

- a claim's session lasts **3 minutes**, one person after another, and asks for no proof;
- claims count **per staff sign-in**, 30 a minute, since everyone in the waiting room shares one
  address;
- the kiosk can have its own switch in the app's settings row. While it is off, the key answers
  `503` `PUBLIC_KEY_OFF` ([below](#switches-in-the-settings-row)).

The kiosk key stops with the app's **staff** side, not the customer side. An update never makes
again a kiosk key you revoked; uninstalling and installing the app does. An update that drops the
kiosk revokes its key.

## Switches in the settings row

An app can tie public writes to yes/no values in its settings row, such as **online booking** or
**new patients online**, so the business can switch them without touching Studio:

- While a switch is off, every write through its entry is refused `403` `PUBLIC_SWITCHED_OFF`.
  Reads keep working, so the page can say why and offer the phone.
- A switch can apply only to a **stranger's create**: new patients online off, while people
  already on file still book.
- A switch reads **off** when the settings row is missing, the column is missing, any row says
  off, or it cannot be read.
- A switch is read at most every 15 seconds, so a change takes up to 15 seconds to show.

The kiosk switch works the same way, for the whole key.

## What the app's keys can never do

The keys were made in your name from what the install check showed, so they stay that narrow:

- They may hold **GET** and **POST**. **PATCH** only on an endpoint where a guest has signed in
  with a claim and so reaches their own rows alone, and never on a column Adminium fills in
  itself, such as a copied price, a code, a running number, a total, a stamp of who or when, or a
  late-cancellation flag.
- They never hold **PUT**, **DELETE** or **BATCH**.
- An endpoint where anyone may create a row never also lets anyone read rows.

An edit to one of their endpoints that would add a write method, drop the sign-in, show more
columns, reach more rows, loosen what a guest may write, or loosen the limits on a stranger's
create is refused with `KEY_MANAGED_UNSAFE`. Narrowing it is always allowed. An update of the app
cannot widen it either. Keys you make yourself are not limited this way.

## When it stops answering

The guests' key answers only while the app is on and its customer side is switched on. A kiosk
key answers only while the app is on and its staff side is switched on. Otherwise every request
with it gets `503`: `APP_DISABLED` when the whole app is disabled, `SURFACE_OFF` when only that
side is off. The change takes effect within seconds, and your own keys are not affected. See
[An app's settings page](/guides/apps/settings/#sets-of-screens).

Uninstalling the app revokes its keys and removes their endpoints.

## Origins

The public API exists only when `ADMINIUM_PUBLIC_API_ORIGINS` is set; unset, its routes are not
there at all. A browser key is accepted only from the origins that variable allows:

- **`self`** allows pages this server serves itself: the customer screens at `/apps/<key>/customer/`
  and on a domain attached to them. Without `self`, the app's own pages cannot call the API.
- **Other origins**, listed exactly, allow pages hosted somewhere else.

```bash
ADMINIUM_PUBLIC_API_ORIGINS='self,https://shop.example.com'
```

See [`ADMINIUM_PUBLIC_API_ORIGINS`](/self-hosting/env-vars/#adminium_public_api_origins) for the
rules that come with it, including the reverse-proxy setting it needs.

## The customer domain

A domain attached to the customer side serves the app's pages and `/api/v1/public/*`, and nothing
of the admin panel. Because the pages and the API share that domain, `self` covers it. See
[What a customer domain serves](/guides/apps/settings/#what-a-customer-domain-serves).

## Rate limits

| What | Limit |
|---|---|
| Each endpoint the install makes | 60 requests a minute per visitor |
| A claim | 5 tries a minute per visitor, and 60 a minute across the whole key |
| Asking for a code and typing one | 10 a minute per session, never counted across the whole key |
| A claim at a kiosk | 30 a minute per staff sign-in, and the whole key's 60 |
| A challenge for the human check | Counted per visitor as a read, never across the whole key |

Claims have their own count across the key, apart from writes, so a flood of guesses cannot stop
bookings. Codes are counted per session, so a flood of strangers cannot stop people already found
from confirming. The limits every browser key has on top of these, and the `429` answer, are in
[Rate limits](/guides/public-api/endpoints-and-keys/#rate-limits).
