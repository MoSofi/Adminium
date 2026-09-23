---
title: An app's public access
description: What an app's customer screens may do through the public API, the key the install makes for them, how guests find their own booking, and what switches it off.
---

An app's **customer screens** are public pages: a booking form, a menu, a guest's own reservation.
They have no signed-in user, so they read and write your database through the
[public API](/guides/public-api/endpoints-and-keys/), with a browser key the install makes for them.
This page covers that key and its endpoints. Everything else about the public API applies to them
unchanged.

## What the install shows first

When an app has customer screens, the table check has a **Public access** card: "The app's
customer screens need to:", then one line per thing they will do, for example:

- **Read** *table*, or **Add to** *table*, or **Change** *table*;
- **Read free or full times of** *table*;
- **Look up their own** *table* **by** *fields*;
- **Add to** *table*, **and get a confirmation email**.

**Allow this public access** is ticked by default, because the customer screens do not work
without it. Untick it and the app installs with no key and no endpoints. **You can narrow it later
on the API keys page.**

Allowing it needs the **Manage API keys** permission as well. Someone without it sees the box
switched off and the line "Only someone who may manage API keys can allow it, so the app installs
without it."

The card also warns about anything that would stop the key working, though the install still goes
ahead:

| Warning | What to do |
|---|---|
| The public API is switched off | Turn on **Public API** in **Workspace settings** |
| The allowed origins do not include "self" | Add `self` to `ADMINIUM_PUBLIC_API_ORIGINS` and restart ([below](#origins)) |
| This database has no time zone set | Set the connection's time zone; dates and times need it |
| Email is not set up | Set up email, or guests get no booking confirmation |

## What the install makes

For each line, one public endpoint on the app's real table:

- **A records endpoint**, named after the table, with the methods the app asked for. It exposes
  the columns the app lists, or else every column it declares for that table, and the writable
  columns and fixed filters the app names. It returns 50 rows by default and at most 200.
- **An availability endpoint**, named *table*`_availability`, when the app takes bookings against
  a limit per time slot. It answers only whether each time of a day is **free** or **full**, and
  never returns a row, a name or a count. See [Free or full](/guides/public-api/endpoints-and-keys/#free-or-full).
- **A claim endpoint**, named *table*`_claimed`, when guests look up their own row. See
  [below](#guests-finding-their-own-booking).

Then one browser key, named after the app with "· guests" at the end, granting exactly those endpoints and methods. It is
not narrowed to any origin. The customer screens fetch it from the server each time they load, so
it never has to be built into them.

## Guests finding their own booking

A claim lets a guest open their own row by proving they know its details, for example a booking
code and a mobile number, with no account. The guest must supply **every** field the app declared
and nothing else, and exactly one row must match. A guest who gets it right receives a session for
30 minutes that reaches that row alone.

Two kinds of field are compared by what they mean, because guests type them from memory:

- **A code** written by a column's code rule is compared the way the rule writes it: upper case,
  spaces removed, the prefix put back, and letters that look like digits read as digits (O as 0,
  I and L as 1). So `mr 4829`, `MR4829` and `4829` all find `MR-4829`.
- **A phone number**, in a column marked as one, is compared by its digits, however it is
  punctuated, and the **whole** number has to agree. A leading `0` trunk prefix and a country code
  the guest left off are allowed for; the last few digits alone never match.

A wrong answer, no match and more than one match all get the same `403` with the code
`PUBLIC_CLAIM_NO_MATCH`. Each visitor has **5 tries a minute** per key.

## What the app's key can never do

The key was made in your name from what the install check showed, so it stays that narrow:

- It may hold **GET** and **POST**. **PATCH** only on an endpoint where a guest has signed in with a
  claim and so reaches their own row alone, and never on a column Adminium fills in itself, such as
  a copied price, a code, a running number or a total.
- It never holds **PUT**, **DELETE** or **BATCH**.
- An endpoint where anyone may create a row never also lets anyone read rows.

An edit to one of its endpoints that would add a write method, drop the sign-in, show more columns
or reach more rows is refused with `KEY_MANAGED_UNSAFE`. Narrowing it is always allowed. An update
of the app cannot widen it either. Keys you make yourself are not limited this way.

## When it stops answering

The key answers only while the app is on and its customer side is switched on. Otherwise every
request with it gets `503`: `APP_DISABLED` when the whole app is disabled, `SURFACE_OFF` when only
the customer side is off. The change takes effect within seconds, and your own keys are not
affected. See [An app's settings page](/guides/apps/settings/#sets-of-screens).

Uninstalling the app revokes the key and removes its endpoints.

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

Each endpoint the install makes allows **60 requests a minute** per visitor. A claim allows 5 tries
a minute per visitor. The limits every browser key has on top of these, and the `429` answer, are
in [Rate limits](/guides/public-api/endpoints-and-keys/#rate-limits).
