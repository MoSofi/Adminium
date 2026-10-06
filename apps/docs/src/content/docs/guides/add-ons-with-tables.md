---
title: Add-ons that keep tables of their own
description: What an add-on may declare beside its code — tables under its own prefix, pages, roles, option lists, starting rows, emails, public entries — and how Adminium installs, updates and removes it.
---

Most add-ons draw something for an app: an invoice, a shipping label. Some keep data of their own:
a stock list, gift cards. From Adminium 0.3.18 such an add-on declares its tables, pages and roles
in its manifest, in the same words an app uses, and Adminium installs them the way it installs an
app. This page says what that means for you as the owner of the server. The fields themselves are
in the [manifest reference](/reference/manifest/#add-on-manifests).

## What it may declare

- **Tables**, always under the add-on's own prefix: the add-on `stock-kit` makes `stock_kit_items`,
  never `items`. A table of yours that already has one of those names is never renamed or changed:
  the check says so and the install stops.
- **Pages** in the dashboard, generated ones and screens of its own code, in a section of the
  sidebar that carries the add-on's name.
- **Roles** that open those pages and tables. Whoever installs the add-on is given its first role,
  so they can open what they just installed. Nobody else gets one until you assign it.
- **Lists of choices** for its columns, **document layouts** for its rows, **emails** it sends from
  a table of its own, and a few **starting rows** (units of measure, reasons, its one settings row).
- **Public entries**, described [below](#what-it-opens-to-the-public).

## One database

All of an add-on's tables go in one database, chosen at install and kept on its record. With one
database connected, nobody is asked. With several, the install dialog asks "Which database?" and
shows what will be made there before you confirm. An add-on cannot be moved to another database
later; uninstall it and install it again where you want it.

## The check, before anything is made

Studio › Add-ons shows, before you confirm: the tables it creates, the pages and roles it adds,
its lists, whether its tables start with rows, and what it would open to the public. The install
makes exactly that. If the database changed between the check and the install, the install stops
and asks you to check again.

An install that stops part way (a full disk, a lost connection) undoes nothing and says at which
step it stopped. Press Install again: it carries on from there, and nothing is made twice.

## Its pages are a screen, not a wall

A page of the add-on's own code is shown only to someone whose role holds that page. That hides
the screen. What actually protects the data is the same thing that protects every table in
Adminium: a person reads or writes one of the add-on's tables only with a role that grants that
table, whichever screen or API they come through.

## Starting rows

An add-on may ship rows its tables hold from the first second. They are written once, at install,
into a table that is empty, in the language of the person installing. They are your rows from then
on: change or delete them freely. Installing the add-on again over tables you kept adds none of
them a second time, and removing sample data never touches them.

## Updating

An update may add tables, columns and indexes to the add-on's own tables. Studio shows what it
adds first when it changes a table or would open something new to the public. While an update
runs the add-on does nothing; when it stops part way, press Update again.

What you changed is kept: a page you edited, a rule you changed, a role you narrowed.

## Removing

Uninstalling removes its pages, roles, rules, email templates, public entries and keys. **Its
tables stay, with every row**, unless you tick "Also delete its tables" and type its key, which
needs Super Admin. A page you edited stays as an ordinary page of your own.

It cannot be removed while an app still hands rows to it or uses it for a feature that is switched
on; the dialog says which.

## What it opens to the public

An add-on may ask for two kinds of public access. Neither is opened by installing it.

1. **Entries served through an app's public key.** A gift-card add-on may let a customer read a
   card's balance by typing its code on the shop's own page. Such an entry is put on the public key
   of an app that names the add-on, and only when you tick **Allow public access** — and only if
   you may manage API keys. Left unticked, the add-on is installed and its entries wait.
2. **One link key of its own.** Whoever holds a row's link opens that one row and can only read
   it. It is made with the same tick.

The entries leave an app's key the moment the add-on stops being there for that app: when you
switch it off for the app, uninstall it, or update it to a version that drops the entry. Switching
it back on does not put them back by itself; Studio asks.

See [An app's public access](/guides/apps/public-access/#what-an-add-on-adds) for how this looks
from the app's side.
