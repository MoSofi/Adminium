# @adminium/public-client

## 0.3.1

### Patch Changes

- 94b24f9: An app's clients can sign in by an emailed link, open a row shared by a link's code, read rows only as far as their parent is theirs, and download their own private files; the public client gains the link, shared-link, file, documents and add-on settings calls.

## 0.3.0

### Patch Changes

- 64a1f12: **Apps can take bookings against people's hours, not just seats per slot.**
  
  A table may carry a booking rule: the practice's opening hours and breaks, each person's own hours,
  closures (for everyone or one person), how many days ahead and how much notice, the slot grid, and
  which kinds of visit each person offers. Every write — a guest's, the desk's, an import's — is held
  to it on the venue's clock, and two people booking the last time at once get one booking. "Anyone"
  picks the first person free in the app's order. Availability answers free or full per time, and a
  strip of days open, full or closed; a person moving their own visit is not blocked by it
  (`exclude`). A cancellation inside the notice window is flagged on the row, and a guest cannot move
  a visit that late. `@adminium/public-client` gains `bookingTimes()` and `bookingDays()`.
- 64a1f12: **An app can have a second key for a kiosk, bound to a signed-in staff member.**
  
  A kiosk's key is served only to the screen of a staff member holding the app's kiosk role (a
  screens-only role with no data), and answers only beside that sign-in, from the same page, with
  its CSRF token on writes, and on the app's own staff host when one is mapped. The app switches it
  off from its settings row (`PUBLIC_KEY_OFF`); it stops with the staff side. Sessions found at a
  kiosk last three minutes, ask no proof of work, and count per screen. An app update rebinds it,
  revokes it when the app drops it, and never re-makes one an operator revoked. The API keys page
  marks it "Staff screen only".
  
  Also fixed: a staff member signed in on the same browser no longer breaks an app's public pages
  (the public API's requests are the key's, not the cookie's), and a screens-only person may call the
  public API.
  
  An app's staff screens also learn what the signed-in person may do: the staff config carries
  `access`, their read / create / update / delete on each of the app's tables and the app's roles
  they hold, so a screen can leave out a button whose write the server would refuse.
  
  A check-in can wait for its time: `writableWhen` takes a window on a time,
  `{starts_at: {within: 60}}`, meaning no more than 60 minutes ahead (a late arrival always
  passes). An earlier change is refused `409` `PUBLIC_TOO_EARLY` with the row's time and when the
  window opens (`params.at`, `params.from`), and only when the row is the caller's own and nothing
  but the window stood in the way; every other miss is still `404`. The public client reads them as
  `error.tooEarly`.
- 64a1f12: **An app's guests can find themselves, prove it by email, and see only their own rows.**
  
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
  - The notice to an old address after a change of email gives the practice's number to ring, when
    the app's outbox names a `phone` column of its settings row (`outbox.settings.phone`, a `text`
    column) and the row holds one; otherwise it still says to get in touch.
  
  `@adminium/public-client` gains `requestCode()`, `verifyCode()`, `session()`, `solveChallenge()`
  with a `humanCheck` option that answers the server, `createWithRank()`, and the new error codes.
- ab31a89: **Apps can ask for public access for their guests, and staff sign in on the app's own address.**
  
  At install you see — and may untick — what an app's guests will be able to do (allowing it needs
  **Manage API keys**): which tables
  they read or write, through which methods and fields. Adminium makes the app its own browser
  key and endpoints; the key cannot be widened to unsafe methods. Availability endpoints answer
  "free" or "full" per time and nothing more; two guests booking the last seats at once get one
  confirmation and one "full". A guest finds their own booking by its code and mobile number (the
  number compared by its digits, however it was typed). Public replies give times as instants, so
  a guest in another time zone sees the venue's time. `@adminium/public-client` gains
  `availability()`, `fromTenantLocal()` and the new error codes (`PUBLIC_SLOT_FULL`,
  `PUBLIC_SLOT_BUSY`, `PUBLIC_TOO_LATE`, `APP_DISABLED`, `SURFACE_OFF`).
  
  On a domain mapped to an app's staff screens, the sign-in page is the venue's: its name and the
  app's, and "Opening <app>…" while the app loads. A first visit in a right-to-left language is laid
  out right to left before anyone signs in.
- ae41762: **The public client can replace, delete and batch-write rows, and `list()` reads every response shape.**
  
  - `replace(ref, id, values)` sends a PUT. Every column the key may write must be included.
  - `remove(ref, id)` deletes one row.
  - `batch(ref, rows)` writes 1 to 500 rows in one transaction and returns `{ count }`.
  
  `list()` returns `{ data, cursor }` whether the endpoint answers wrapped, as a bare array (the
  next cursor comes from `X-Next-Cursor`) or as a single row, and it makes no extra request to
  find out which. `PublicAction` gains `replace`, `delete` and `batch`, and a ref's config may
  carry `response.shape`. These need a server from 0.3.0.

## 0.3.0-rc.4

### Patch Changes

- ab31a89: **Apps can ask for public access for their guests, and staff sign in on the app's own address.**
  
  At install you see — and may untick — what an app's guests will be able to do (allowing it needs
  **Manage API keys**): which tables
  they read or write, through which methods and fields. Adminium makes the app its own browser
  key and endpoints; the key cannot be widened to unsafe methods. Availability endpoints answer
  "free" or "full" per time and nothing more; two guests booking the last seats at once get one
  confirmation and one "full". A guest finds their own booking by its code and mobile number (the
  number compared by its digits, however it was typed). Public replies give times as instants, so
  a guest in another time zone sees the venue's time. `@adminium/public-client` gains
  `availability()`, `fromTenantLocal()` and the new error codes (`PUBLIC_SLOT_FULL`,
  `PUBLIC_SLOT_BUSY`, `PUBLIC_TOO_LATE`, `APP_DISABLED`, `SURFACE_OFF`).
  
  On a domain mapped to an app's staff screens, the sign-in page is the venue's: its name and the
  app's, and "Opening <app>…" while the app loads. A first visit in a right-to-left language is laid
  out right to left before anyone signs in.

## 0.3.0-rc.3

### Patch Changes

- ae41762: **The public client can replace, delete and batch-write rows, and `list()` reads every response shape.**
  
  - `replace(ref, id, values)` sends a PUT. Every column the key may write must be included.
  - `remove(ref, id)` deletes one row.
  - `batch(ref, rows)` writes 1 to 500 rows in one transaction and returns `{ count }`.
  
  `list()` returns `{ data, cursor }` whether the endpoint answers wrapped, as a bare array (the
  next cursor comes from `X-Next-Cursor`) or as a single row, and it makes no extra request to
  find out which. `PublicAction` gains `replace`, `delete` and `batch`, and a ref's config may
  carry `response.shape`. These need a server from 0.3.0.

## 0.3.0-rc.2

## 0.3.0-rc.1

## 0.3.0-rc.0

## 0.2.9

## 0.2.8

## 0.2.7

## 0.2.6

## 0.2.5

## 0.2.4

## 0.2.3

## 0.2.2

### Patch Changes

- a94f776: Add the browser client for the scoped public API: a dependency-free
  `createPublicClient` that returns `null` when its build-time env is absent, so a
  demo build falls back to seed data structurally rather than in a catch, plus the
  tenant-timezone helpers every connected app needs to avoid rendering a
  15:00 London appointment at 16:00 in a Berlin browser.
