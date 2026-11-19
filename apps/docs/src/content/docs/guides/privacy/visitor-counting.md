---
title: Visitor counting
description: How often your landing pages and forms are seen. Three levels (Off, Counts only, Per visitor), what is counted and what is left out, the banner, the cookie, where the counts show and how long they are kept.
---

From Adminium 0.3.65.

Adminium counts how many times strangers see your landing pages and your
forms. You choose how much it keeps, on **Server settings → Privacy & public
pages → Visitor counting**. The tab is shown to whoever holds the privacy
permission, as the rest of that screen is (see
[A person's data](/guides/email/privacy/)).

## The three levels

| Level | What it keeps | Cookie | Banner |
|---|---|---|---|
| **Off** | Nothing. | No | No |
| **Counts only** (the default) | How many times each page and form was seen, per day. | No | No |
| **Per visitor** | The counts, and, for a visitor who says yes, which of your pages they saw. | Only after "Yes" | Yes |

**Counts only** is on from 0.3.65, on a new server and on one you upgrade.
These are views, not people: one person who comes back tomorrow is two views.
Nothing about the visitor is kept, not even their address.

The tab shows when counting started ("Counting started on …"). Days before
that show nothing. Switching to **Off** stops counting; what was counted stays
until its months are up. Going back up from Off starts counting again from
that moment.

## What is counted

- **A landing page**, each time it is opened.
- **A form on its own page**, or in a frame on your website.
- **A form on a landing page**: once when it comes into view ("opened"), and
  once when it is sent ("sent"). These counts are kept by the page the form
  was on.
- **A form sent**, wherever it was sent from. Every answer that is kept
  counts. A refused or failed answer does not.

The live chat is not counted. Nor are an app's customer side, the pay page or
the links in your mail.

A view is counted when the page's own script asks for its content. So these
are left out:

- known bots and crawlers, link previews (a chat app's or a social site's),
  uptime monitors, headless browsers and scripts;
- a page the browser fetched in case it is opened (a prefetch);
- a second view of the same page from the same network address within 30
  minutes;
- the preview in the editor, a draft, and a page or form that is off.

Opening your own live page counts as a view.

Days are your business's days: the time zone of the database the add-on is
in, else UTC.

## Where the counts show

- The **Landing pages** list shows each page's views this month.
- A **funnel** shows the views of each step and the sends of each form, over
  a date range you pick (see [The Landing pages add-on](/guides/add-ons/landing-pages/#funnels)).
- An app or a screen of your own reads them at `GET /api/v1/views` (see the
  [REST API](/reference/rest-api/)). Whoever may read the counted thing's
  table may read its counts. A role held to some of its rows is refused: the
  counts are of every row.

## Per visitor

Per visitor remembers which of your pages one visitor saw, and joins that to
them if they send a form. It asks first. Nothing is kept before they say yes.

**It needs the privacy notice.** The banner links to it, so the level cannot
be chosen until the business name and the privacy notice address are set (see
[The privacy notice](/guides/email/privacy/#the-privacy-notice-and-the-postal-address)).

**It works only on Adminium's own pages**: landing pages and form pages, on
this server's public address or on a host you mapped to forms and pages (see
[An app surface on its own domain](/self-hosting/app-domains/)). A form in a
frame on your website never shows the banner and never reads or sets the
cookie: it is counted as at Counts only.

### The banner

The banner asks "Can we remember your visit?". It sits docked at the bottom of
the window, under the page, never over it. Its **Yes** and **No** buttons look
the same, so saying no is as easy as saying yes. It speaks the page's language
when that is one of Adminium's eight, else English.

Under **The banner** on the tab you can write your own words, per language:
the title, the message and the two buttons. A field left empty keeps the
default words. The preview shows the banner as a visitor sees it.

### What "Yes" keeps

- **A cookie**, `__Host-adm_v`: on this host only, never readable by a script,
  sent only over https and never from a frame on another site. It lasts 180
  days; then the banner asks again.
- **On the server**, from the visitor's first counted view: a keyed code of
  the cookie, the host, when they said yes, and which banner words they saw.
  Never their network address, their browser or the cookie itself.
- **The pages they saw**: each landing page and form page they opened, with
  the day.

"No" is kept in the visitor's browser alone. Nothing is sent to the server.
The banner asks again after 180 days.

### A visitor who sends a form

When a visitor who said yes sends a form on one of your pages, the address
they give is joined to them, as a keyed code. Their pages then belong to that
person:

- **A person's data** finds them by that address, as **Pages they saw**, and
  the download lists each page with its day.
- **Erasing the person** deletes their pages and their visitor.

If a second address is sent from the same browser, that browser becomes a new
visitor, so neither address holds the other's pages. A visitor who never
sends a form has no address. Nobody can find them, and their pages go when
their months are up or when they take their yes back.

### Taking it back

Every landing page and form page has **Cookie choice** at the bottom. It opens
the banner again. "No" after a "yes" deletes that visitor's pages and clears
the cookie. It works at every level, so a visitor can always take a yes back.

### Going down from Per visitor

Switching to Counts only or Off ends what the visitors said yes to. Adminium
asks first ("Stop counting per visitor?") and says how many visitors' page
history goes. **Delete and save** deletes all of it at once. The audit log
keeps the counts, never a visitor. A cookie left in a browser names nobody
from then on.

## How long things are kept

Two rows on **How long we keep things** belong to counting:

| Row | What | Kept by default |
|---|---|---|
| **View counts** | The views of your landing pages and forms, per day | 13 months |
| **Pages a visitor saw** | At Per visitor, the pages one visitor saw | 6 months |

You can choose 3, 6, 12, 13, 24 or 36 months for each. Every night Adminium
deletes what is older. Pages a visitor saw also go with the person when they
are erased.

## For operators

- **Behind a reverse proxy**, set `ADMINIUM_TRUST_PROXY=on`. Counting tells
  visitors apart by their network address, and the cookie is set only on a
  request the server sees as https. Without it, your public pages answer
  "not available" to visitors who come through the proxy (see
  [Behind a reverse proxy](/self-hosting/reverse-proxy/)).
- With several server processes, a change of level reaches each of them
  within a few seconds.
- The level is changed with `PUT /api/v1/privacy/counting`
  (`{ "level": "off" | "counts" | "visitor", "banner"?: … }`). Per visitor
  without the privacy notice is refused with 409 `PER_VISITOR_NEEDS_NOTICE`.
  The months are changed with `PUT /api/v1/privacy/keeping`.
