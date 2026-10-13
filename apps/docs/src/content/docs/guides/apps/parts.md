---
title: Parts of an app
description: Switch off the parts of an app a business does not use, know exactly what "off" stops and what it leaves, and ship an app that is made of parts.
---

Some apps are made of **parts**: a sales app may have Selling, an Inbox, a Showroom, Jobs on site
and Vehicles. A firm that never sends a crew out does not want the pages, the roles and the nightly
rules of "Jobs on site". It switches that part off.

## Switching a part

Open **Studio → Apps**, the app, and its **Parts** card. Each part shows what it holds: its pages,
the rules that are on, and its roles.

- A part marked **Always on** has no switch.
- A part marked **Needs an add-on** is off until that add-on is connected to the app, on the
  Add-ons card of the same page.
- Every other part has a switch, and the switch asks before it acts.

**Switching off** first lists what is open in the part: records that are part way through (a job
not signed off), the rules that will stop, and the people who will be left with nothing switched
on. None of it stops you; it is there so that nothing stops unnoticed.

**Switching on** takes effect at once, with no update and no restart. It does **not** catch up:
a rule of the part did not run for what changed while the part was off, and does not run for it
now.

When you install an app made of parts, the install check has a **Parts** card with a tick for each
part that has a switch. The ticks are only where the parts start.

## What "off" stops

| Of the part | While it is off |
|---|---|
| Pages | Out of the menu. Their addresses say "This part of the app is switched off". Search does not find them. |
| Rules the app shipped | Start no run. A run that was already waiting is passed over, and its log says why. |
| Documents, emails, public entries | Not drawn, not queued, closed. An email that was already queued is still sent. |
| Scheduled reports over its pages | Wait, and are due again at their next time. A new one cannot be made. |
| Roles | A role whose parts are all off gives nothing and is offered to nobody new. |
| The app's own screens | The app is told which parts are on and hides the screens of one that is off. |

Somebody whose every role belongs to parts that are off sees **Nothing is switched on for you**,
in the dashboard or on the app's own screens, instead of an empty page.

## What "off" leaves

**The records stay.** Nothing is deleted and no table is dropped.

**Other parts keep reading them, and nobody writes them.** A role of a part that is *on* and is
granted a table of a part that is *off* still reads it. An account manager goes on seeing a won
deal's job after "Jobs on site" is switched off. It does not write it: no role creates, changes,
deletes or imports rows of a part that is off.

So "off" hides a part and stops what it does. It is not a way to lock data away: for that, change
what the roles are granted, or hold a role to [some rows](/guides/apps/whose-a-row-is/).

A rule **you** made (not one the app shipped), or a copy you made of a shipped rule, is yours and
is not stopped by a part.

## A part that waits for an add-on

A part can be built on an add-on: quotes on Invoices & Receipts, for example. Such an app installs
without the add-on, and the part is then **left out**: its tables are not made at all. The Parts
card says so, and which add-on would bring it.

Connect the add-on (the Add-ons card on the same page) and the part is put in: its tables, its
pages and its roles are made, and nothing that was already there is touched. Sample data that was
added before the part was put in does not grow the part's sample rows afterwards.

Once a part is in, it stays in. Switching its add-on off for the app turns the part off; it takes
nothing away.

## For an app's author

A manifest declares its parts in [`modules`](/reference/manifest/#parts) and puts a table, a page,
a rule, a document, an email producer or a public entry in one with `"module": "<id>"`. A role
lists its parts in `"modules"`.

- Give every part that a business can do without `"default": "on"` or `"off"`, and keep
  `"always"` for what the rest of the app cannot work without.
- A role that only makes sense with one part names that part alone, so it is not offered without
  it. A role that works across parts names each of them; its grants on a part's tables then lapse
  with that part and the rest stay.
- To let a role keep reading a table when the table's part is off, leave that part out of the
  role's `modules`.
- A table built on an add-on's shape goes in a part whose `feature` requires that add-on. The
  manifest check then also checks the app **without** the add-on: whatever is left must stand on
  its own.
