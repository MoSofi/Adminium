---
title: An app's screens on your website
description: How an app lets a listed website show its customer screens in a frame — the manifest word, the snippet, the three ways to show it, the frame helper in the public client, paying from a frame, and what the website may be told.
---

A customer side can appear on the owner's own website: a booking page in the middle of a page, a
button that opens it, or a launcher in a corner. Three pieces do it:

- the **manifest** says which screens a website may load;
- the **snippet** puts one on the page, through the website loader `/x/embed.js`;
- the **frame helper** in the public client holds the frame to those screens and talks to the
  loader.

A manifest line alone is not enough. It changes a response header, and the app must also use the
helper.

## Declare the screens

```json
{
  "side": "customer",
  "kind": "spa",
  "entry": "index.html",
  "embed": {
    "paths": [
      "/",
      {
        "path": "/book",
        "label": "Book a service",
        "choose": {
          "query": "service", "table": "services", "value": "slug", "label": "name",
          "title": "A particular service", "any": "Any service"
        }
      },
      "/reviews"
    ],
    "modes": ["inline", "button", "floating"]
  }
}
```

A path is compared whole, after the side's address, with no query: `/book` also covers
`/book?service=gel`, and nothing under it. `choose` lets the snippet maker offer a table's values
as that query. It reads those two columns, which must be shown columns of an open table, and not
JSON or files. The query may not be called `frame`, `mode`, `lang` or `theme`: the loader writes those.

**Never declare a path that carries a private link or an action on somebody's record**, such as a
booking's own page with its Cancel button. A state reached after a booking made in the frame needs
no address of its own.

The list decides which addresses a website on **Privacy → Your websites** may load, with
`?frame=1`. It is read once, when the frame loads. The app changes screens in the browser with no
new request, so holding the frame to its screens is the helper's job.

Every other answer keeps `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`, so the browser
refuses the frame. Every `?frame=1` answer is `no-store` and `noindex`.

## The snippet

**Privacy → Your websites** has a snippet maker for every installed app that declares screens.
It writes two lines:

```html
<script src="https://admin.example.com/x/embed.js" async></script>
<div data-adminium-app="bookings" data-path="/book?service=gel" data-mode="inline">
  <a href="https://admin.example.com/apps/bookings/customer/book?service=gel">Book online</a>
</div>
```

| Attribute | What it says |
|---|---|
| `data-adminium-app` | The app's key, or `<key>~<copy>` for a later copy of it. |
| `data-path` | The screen: `/`, plain letters, no `//`, no `.` or `..` part, an optional plain query. Anything else draws nothing. |
| `data-mode` | `inline` (the default), `button` or `floating`. At most one `button` or `floating` per page. |
| `data-label` | The launcher's words, at most 28 letters. Set as text. |
| `data-title` | The frame's accessible name. |
| `data-theme` | `light` (the default) or `dark`. |

- **Inline** sits in the page and grows with its content.
- **Button** makes the element itself the site's own button. Until the frame is ready it is a plain
  link. `adminium.app.open()` and `.close()` do the same from your own code.
- **Floating** draws a launcher in the page's end corner, or the other corner when the page also
  has the chat. The launcher and its sheet are drawn inside the frame, so the site's CSS cannot
  reach them.

The frame shows nothing until it has a size, and the element's own link stays until then. So a
website taken off the list, a switched-off side or a server that is down leaves a plain link
rather than the browser's error box.

A website with its own content security policy must allow the Adminium address in `script-src`
and `frame-src`.

## The frame helper

```ts
import { createPublicClient } from '@adminium/public-client';
import { readFrame, startFrame } from '@adminium/public-client/frame';

const frame = readFrame(); // null outside a frame, and for a copied link opened in its own tab
const config = await (await fetch(`surface-config.json${frame ? '?frame=1' : ''}`)).json();
const client = createPublicClient({ ...config, framed: frame !== null });

const link = frame && startFrame({
  origins: config.frameOrigins ?? [],
  screens: ['book', 'booked', 'reviews'],
  base: '/apps/bookings/customer',
});
```

- **Screens.** Ask `link.go(screen, path)` before showing a screen, from the click. It answers true
  for the screens you listed. Any other (sign-in, a person's visits, a private booking page) opens
  the app's own address in a new tab and answers false. `link.linkProps(path)` gives the same
  address as a real link.
- **Layout.** An inline frame is as tall as its content, so a bar fixed to the bottom, a centred
  dialog and `100vh` all misbehave. The helper takes `height` and `min-height` off `<html>` and
  `<body>`; lay out everything else as normal blocks. `<html data-adminium-frame="inline">` is there
  to key on. In a sheet the frame is the viewport, and the normal phone layout applies.
- **Steps.** Call `link.scrollIntoView()` when a step changes, and change the address with
  `replaceState`, so the site's Back button is not filled with the frame's steps.
- **Sheet.** `link.size(w, h)` sizes the launcher, `link.openSheet()` and `link.closeSheet()` open
  and close it. Escape closes it, and focus goes back to the site.
- **Storage.** A third-party frame's storage is partitioned, may be forgotten when the browser
  quits, and may be refused. `frameStore()` holds values in memory first and copies them when it can.
- **Language.** `frame.lang` is the host page's. Read it before any stored choice.

## What the website may be told

`link.done(code)` fires one event on the snippet's element:

```js
document.addEventListener('adminium:booked', (event) => console.log(event.detail.code));
```

Every script on that page hears it, and any listed website may frame the screen. So it may carry
only a value that, **alone or with what the host page already knows, opens nothing**. Never a
name, an e-mail, a private link, or a code that is half of a claim. If your code is one of those,
call `link.done()` with nothing.

## Paying from a frame

The pay page can never be framed, so it opens in its own tab, and that tab and the frame share no
storage.

1. Offer a **real link** the guest presses: `<a {...payLinkProps(payUrl)}>`. A tab opened by a script
   after a wait is blocked as a pop-up.
2. While the frame waits, `watchPayment` reads the record from the server every 3 seconds while
   the page is visible, and at once when the guest comes back. It reports `paying`, `confirming`,
   `paid` or `let-go`, and stops on the last two. Past the hold's end and a margin, an unpaid
   record is let go. If the server cannot be asked three times running by then, nobody can say
   whether it was paid: `onLost` fires, so say that and point to the confirmation e-mail.
3. A payment started by a client made with `framed: true` ends in the pay tab with "You can close
   this tab" and no way back. A declined card stays on the page to try again. The mark is kept on the pay link and never travels in an address.

A page that is the app's `returnTo` works with no session: `takePayReturn()` gives the screen
remembered with `rememberPayReturn(path)` in that tab, once, or null when the guest arrived in a new
tab or on another device. Then say thank you, and that the confirmation is on its way by e-mail.
