---
title: "Lead finder: the website reader"
description: Adminium reads one page of a company's own website, only when you press Read, for the company's own facts. No key. It honours robots.txt, noindex and the text and data mining reservation, and says one of three things when it cannot read.
---

The website reader fills in a company's details from its own website: its name, the line it
describes itself with, its address, its switchboard number and a shared address such as `info@`.
It is part of Adminium, not of the add-on: the add-on never fetches a website, so it never holds a
way to send your other keys anywhere.

- **Key:** none. Its card says "Needs no key" and that it may contact **only the website you
  enter**.
- **When:** only when somebody presses **Read** in a company's **Fill in details** sheet. It reads
  the address in the record's website field: never one a stranger typed into a form, and never in a
  rule.
- **What:** one page, the site's home page.
- **Who it says it is:** `Adminium-LeadFinder/1 (+https://adminium.dev/lead-finder)`.

## What it takes, and what it never takes

From the one page it reads, it takes only typed facts about the company:

- its **name**, as the site names itself;
- **About**: the site's own description of itself (`<meta name="description">`), never the text of
  the page, which is somebody's writing and may name people;
- its **address**, **phone** and **website**, from the site's structured data (JSON-LD
  `Organization`) or the page;
- up to three **shared addresses** (`info@`, `contact@`, `post@` and the like) and two phone
  numbers.

It never takes an address that names somebody, never a mobile number where the country is known
(a mobile is a person's), and never anything a page says about its people (founders, staff). The
website reader finds no people: only Hunter does, and only while People is on.

## Sites that ask not to be read

Before the page, it reads the site's `robots.txt`, and obeys the group for `Adminium` (or
`Adminium-LeadFinder`), else the one for every robot:

- a rule against the home page: nothing is read;
- no `robots.txt` at all (the site answers "not found"): reading is allowed;
- a site whose `robots.txt` cannot be had (it fails, or does not answer): nothing is read.

It also leaves a page alone that says `noindex` (in a `<meta name="robots">` tag or an
`X-Robots-Tag` header), or that reserves its text and data from mining (`tdm-reservation`). What a
site's `robots.txt` says is remembered for a day.

## How it reads

- **https first.** Plain http is tried only when nothing answers on https at all, and nothing of
  yours ever goes over it: the reader sends no key and no cookie, ever.
- **Within the site.** It follows a redirect between the site's own names (`www.` and the bare
  name, http to https), never from https to http. A redirect to **another** site stops and asks:
  "This website sends visitors to {host}." You may confirm that host and read again.
- **A web page only:** HTML, at most 2 MiB, 10 seconds per request.
- **Never inside your network.** A name that leads to a private address, a bare address, or another
  port is refused, whatever the network settings say.
- **Gently.** At most two reads at once on your install, and one per site.

## The three things it can say

When it cannot read, the sheet says one of three things:

- **"This website asks tools not to read it, so we didn't."** Its `robots.txt`, a `noindex`, or a
  mining reservation said no, or its `robots.txt` could not be had.
- **"That address is not a web page Lead finder can read."** The answer was not an HTML page, or was
  too large.
- **"Couldn't reach the website."** Every other failure: no such site, not public, no answer, an
  error.

What exactly went wrong goes to the server's log, with the host and path only. It is not shown,
because it would tell a member of staff which names exist inside your server's network.

## Switching it off

Turn its card's switch off in **Sources**, and the sheet says "The website reader is switched off
in Sources." instead of reading. On a server that calls
nothing outside (`ADMINIUM_NETWORK_FEATURES=off`, or a trial), it reads nothing.
