---
title: Customer reviews
description: How an app lets customers review what they bought, how an add-on keeps the reviews and their totals, what staff may do with them, and what Adminium does for a person who is forgotten.
---

A shop's customer reviews a jacket from an order line once the order has shipped; a studio's customer
reviews a visit once it is done. The review is kept by an add-on (Forms & surveys), written by
Adminium from what the app says, and moderated by the app's own staff. These words need Adminium
0.3.68 or later.

## The app: what may be reviewed

The app puts a `review` word on the table of the rows reviewed:

```json
"order_lines": {
  "review": {
    "by": { "addOn": "forms" },
    "needs": "reviews",
    "about": { "link": "product_id", "name": "product_name" },
    "when": { "path": ["order_id", "status"], "in": ["shipped", "returned", "refunded"] },
    "person": ["order_id", "customer_id"],
    "proved": ["order_id", "customer_proved"],
    "shownName": { "first": "first_name", "last": "last_name" },
    "stamp": "reviewed_at"
  }
}
```

| Key | Means |
|---|---|
| `by.addOn` | The add-on that keeps the reviews. The app names it in `addOns`. |
| `needs` | Optional: the feature that switches reviews on and off. |
| `about.link` | What the row is about: a link of the table (the product). |
| `about.name`, `about.detail` | The thing's name, and an optional second line, copied when the review is taken: a column, or links then a column. |
| `when` | The row may be reviewed only while the value along `path` is one of `in`. |
| `person` | The links from the row to the person whose review it is. It must be the way the app's own entries reach that person: a person's own rows (`claimedBy`), or rows seen with a parent that is (`visibleWith`). |
| `proved` | Optional: the yes/no along links that says the person proved who they are when the row was made (a guest's typed address proves nothing). With it, the row's own link may review only a proved row, and is never told the name of an unproved one's person; a person signed in on their own row always may. Needs Adminium 0.3.70. |
| `shownName` | How the name is shown: `first` and `last`, or `full`. |
| `stamp` | A nullable moment Adminium sets when the review is taken. No entry writes it. |

Only an app's own table takes the word, and the table has one key column.

## The customer: asking and sending

A page asks about a row it reads through a person's own entry, signed in at the verified level or
opened by the row's own link:

```text
GET /api/v1/public/records/<ref>/<id>/review
→ { "data": { "open": true, "reviewedAt": null, "shownName": "Priya R." } }
```

`open` is true while the row may be reviewed: not reviewed yet, and its `when` holds. The answer is
404 while reviews are off for the app; the page then hides its reviews.

```text
POST /api/v1/public/records/<ref>/<id>/review
{ "stars": 4, "title": "Warm", "body": "Kept me dry for three days." }
→ 201 { "data": { "reviewedAt": "2026-11-20T10:00:00.000Z" } }
```

The browser sends whole stars from 1 to 5, and optional words: a title of up to 80 characters and a
review of up to 2,000. The words may hold digits, line breaks and ordinary punctuation, never a
web address, an e-mail address or a handle; they are always shown as text. Everything else is filled
by Adminium: the app, the row, what it is about and its name, the name shown, and whose review it is.

The name shown is the person's first name and the first letter of their last name ("Priya R.").
With no name it is empty, and the page shows "A customer" in its reader's language.

| Answer | When |
|---|---|
| `404 PUBLIC_REF_NOT_FOUND` | Not a row this session reads, through a person's own entry: another customer's line, an unknown id |
| `403 PUBLIC_CLAIM_LEVEL` | The session has not confirmed its code yet |
| `409 PUBLIC_REVIEW_NOT_YET` | The row may not be reviewed yet (the order is not shipped) |
| `409 PUBLIC_REVIEW_DONE` | The row was reviewed already. Two sends at once take one review |
| `409 PUBLIC_SWITCHED_OFF` | Reviews are off for the app |
| `409 PUBLIC_WRITE_REFUSED` | The row is about nothing, or reaches no person, or the person asked to be forgotten |
| `400 PUBLIC_WRITE_REJECTED` | The words hold an address |
| `429 PUBLIC_RATE_LIMITED` | More than 10 tries an hour from one session |

A review starts **waiting**. The line's stamp tells the page it was sent ("Your review: sent").

## The add-on: where reviews are kept

The add-on declares its two tables, `addOn.reviews: { "reviews": "reviews", "totals": "review_totals" }`.
Each has the columns Adminium reads and writes, by these names:

- **reviews**: `app`, `subject_table`, `subject_key` (unique together, text of 64, 64 and 200
  characters), `about_table`, `about_key`, `about_name`, `about_detail`, `stars`, `title`, `body`,
  `shown_name`, `state` (`waiting`, `published`, `hidden`), `hide_reason` (`abusive`,
  `names-someone`, `not-about-us`, `looks-fake`, and from 0.3.71 `author-asked`, which an add-on may add), `reply`, `replied_at`, `submitted_at`,
  `person_table`, `person_key`.
- **totals**: `app`, `about_table`, `about_key` (unique together, text of 64, 64 and 200
  characters), `count`, `sum`, `c1` to `c5`. One row per thing reviewed, and one for the whole app
  with `about_table` and `about_key` empty.

What may hold them:

- An app's role may read and update the reviews (`appGrants`), changing only `state`,
  `hide_reason` and `reply`, and read the totals. The add-on sets `appGrants.appColumn: "app"`, so an
  app's role reaches only its own app's reviews.
- The add-on's own roles hold nothing of the reviews, and may only read the totals.
- No step writes either. A public entry only reads them, held to its app (`appColumn: "app"`).

## Staff: moderating

Staff move a review between its states, give a reason to hide it, and reply. Whoever they are, the
Super Admin included, they cannot change anything else, create a review, or delete one, and they
change one review at a time. A review is hidden only with one of the four reasons; the reasons are
never about the stars. A reply is stamped by Adminium. A published review can be hidden later.

## Totals

Adminium keeps the totals in the same transaction as every change of a review's state. A review that
becomes published adds one to the count, its stars to the sum and one to its stars' bar, on its
thing's row and on the app's row; one that stops being published takes them off. Waiting and hidden
reviews are in no total. The average is `sum / count`, to one decimal. When the add-on is installed
or updated, every total is worked out again from the published reviews.

## A forgotten person

When a person uses "Delete my details", or staff erase them, each of their reviews keeps its stars,
words and totals, and loses its name and whose it is. The page shows "A customer".

Their reviews are part of their data: **Privacy → Person data** lists them under "What they gave
you", **Download everything** writes them (what each is about, the stars, the words, the name shown,
its state, the reply and when it was sent), and the erasure's preview says how many will be kept
without their name. A search or an erasure held to some apps finds those apps' reviews only.
