---
title: Bookings in a calendar, and the mails after a visit
description: How a booking becomes a calendar invitation and a private feed, how a review mail carries its own link and a stop link, how a public box records a no, and how a studio's cancel refunds by itself.
---

These words need Adminium 0.3.71 or later.

## A booking as a calendar entry

`table.booking.calendar` says what a booking's calendar entry holds:

```json
"calendar": {
  "revision": "revision",
  "title": ["service_id", "name"],
  "code": "code",
  "person": ["team_id", "first_name"],
  "studio": {
    "name": { "table": "settings", "column": "name" },
    "address": { "table": "settings", "column": "address" },
    "website": { "table": "settings", "column": "website" }
  },
  "notice": { "en-US": "Declining in your calendar does not cancel. Use your booking link." },
  "feed": {
    "own": "email",
    "active": "active",
    "detail": { "table": "settings", "column": "calendar_detail" },
    "customer": ["customer_id", "name"]
  }
}
```

- `revision` is a whole-number column, not nullable. Only Adminium writes it. It rises whenever the
  start, the length, the person or the cancelled state changes, so a calendar takes the newest of
  two quick moves.
- `title`, `person` and `code` are the only facts of the row an entry shows. There is no word for a
  guest's note, phone or price, and an entry never carries a link that opens the booking: an entry
  is copied to shared calendars and forwarded with every field.
- `notice` is required. It is the line that says declining in a calendar does not cancel the visit.

Times are UTC, so an entry is right on both sides of a clock change and shows in its reader's own
zone. The entry's UID is the app, the row and this install, so two studios' first bookings are two
events.

### On a mail

A template carries the entry by naming the outbox link of the booking:

```json
{ "key": "studio-booked", "calendar": { "link": "visit" }, "locales": { } }
```

While the booking takes its time the mail is an invitation (`METHOD:REQUEST`, the studio as
organiser, the guest as the one attendee, replies off). Once it does not, the same entry goes as a
cancellation. The template may also print `{{calendarGoogle}}` and `{{calendarOutlook}}`, two links
that hold the same fields. They add a separate event that later changes do not reach, and they are
empty for a cancelled visit.

How Gmail, Outlook and Apple Mail show an invitation differs by client, so try yours before relying
on it.

### On a page

`GET /api/v1/public/records/:ref/:id/calendar` answers a row the session reads as its own with the
plain file and the two links, for an "Add to calendar" button.

### A person's private feed

With `feed`, each person the booking table is booked with has a private link that a calendar service
can subscribe to. It holds their counted bookings from 30 days back to 60 ahead.

- `GET /api/v1/calendar-feed?connection=&table=&row=` answers `{ link, own }` to anyone who may
  change that person's row. Only the person whose sign-in address is in `own` is given the link.
- `POST /api/v1/calendar-feed/renew` makes a new link and ends the old one at once. An owner may
  renew anyone's and is not shown the new link. A renew is in the audit log.
- A person made inactive or deleted, or an app switched off, ends the feed. While `detail` reads
  `name`, entries show the customer's first name and initial; otherwise the service alone.

Anyone with the link can read that diary, so say so beside it.

## A review link only the mail carries

A booking's own link goes to whoever made the booking, and a stranger can make one in anybody's
address. So when a review word names `proved`, that link cannot review a guest's visit. The review
mail can, because it reaches only the mailbox on the person's row:

```json
"outbox": {
  "reviewLinks": { "kinds": ["review-request", "review-reminder"], "link": "visit", "page": "/review" }
}
```

A template of those kinds prints `{{reviewLink}}`, which opens `page` with the token in the fragment.
The page reads it with `POST /api/v1/public/review-link` and sends the review to
`POST /api/v1/public/review-link/take`, each with `{ "token" }` in the body. The link reviews that
one row, once, for 30 days. It opens no session, and it stops working if the person's address changes
or they ask to be forgotten.

## The stop link, and a box that says no

A service mail whose kind names a purpose (`outbox.purposes`) carries the two `List-Unsubscribe`
headers, and its template may print `{{stopLink}}`. The link leads to the same page a marketing
mail's does, and records the person's "no" for that purpose.

A public box can record the same "no":

```json
"consent": {
  "column": "no_review_request",
  "purpose": "surveys",
  "means": "no",
  "wording": { "version": 1, "text": { "en-US": "Don't send me a review request" } }
}
```

Ticked, it writes the person's "no" with the sentence shown. Unticked, it writes nothing. Anybody may
give it, because it can only stop mail, so someone who types another person's address can stop that
person's review requests until they switch them back on where they are signed in. The column is a
box of its own: it cannot be the yes column in `people[].consent`.

A people table's yes column may default to yes. A new row that only holds that default adds nothing
to the consent log: nobody was asked.

## A cancel by the studio

`refundOn` can refund a studio's cancel whoever pressed it, and hold only the customer to the late
window:

```json
"refundOn": {
  "moves": [{ "from": ["booked"], "to": "cancelled", "by": ["customer", "system", "staff"] }],
  "before": { "column": "starts_at", "hours": { "table": "settings", "column": "cancel_hours" }, "binds": ["customer"] }
}
```

`staff` is any signed-in person's own move on a staff screen, whether or not they hold the refund
right. A rule or a key is not, and leaves "Refund owed" as before. With `binds`, a customer who
cancels late gets nothing back and is owed nothing, while the studio's own cancel is refunded in
full.

To keep the late flag for a customer's cancel only, use `states.late` with a `where` on who
cancelled, not `booking.cancel.flag`, which is set whoever writes.
