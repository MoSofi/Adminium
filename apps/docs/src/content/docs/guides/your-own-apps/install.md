---
title: Installing your own app
description: Install an app file someone saved with Save as app. The review (where it was made, the fingerprint, the tables already there, page clashes, outside addresses arriving off, what to do afterwards), updates, installing on another database, and every refusal in plain words.
---

An app file made with [Save as app](/guides/your-own-apps/save-as-app/) installs the way any app
file does: **Studio → Hosted apps → Install an app**, then upload the `.tgz`. The steps are the
usual four, **Bundle**, **Database**, **Schema plan** and **Done**, described in
[Installing apps](/self-hosting/installing-apps/#installing-an-app). This page covers what is
different for a file of your own.

Installing needs the **Install and manage apps and add-ons** permission. Nothing is written until
you press **Install**.

## Database

The app goes into a database this server already has. Connect the database first: the wizard never
adds one. Each database is listed once, with its workspace chips when the server has
[workspaces](/guides/workspaces/).

The step says which version is being installed ("Installing Fernhill Ops 1.2.0."). A database that
already has this app reads **Installed · 1.1.0** and cannot be picked. Each database can have its
own copy of an app: see [An app on several databases](/self-hosting/apps-per-database/).

## The review

For a file of your own, the schema plan step is called **Check before you install**. It shows, from
the top:

### Where it came from

The app's name, its version, the **Your own app** badge, and the line "Made at *Fernhill main* on
*1 Nov 2026* · Adminium *0.3.49*": the label the person gave when they saved it, the date, and the
Adminium that saved it. A warning says it was saved on another Adminium server, not on
adminium.dev, so install it only if you know who saved it.

### The fingerprint

**Check against the fingerprint shown when it was saved** takes the `sha512-…` value the person
copied from their Download step. **Check** (or Enter) compares it with the file, in your browser:

| Result | What happens |
|---|---|
| **Matches. This is the file that was saved.** | Install is allowed |
| **Does not match. This is not the file that was saved.** | **Install stays off** until you clear the field or paste the right one |
| **Not checked** (the field is empty) | Install is allowed |

A released app uploaded by hand gets the same field, worded **…published with the release**.

### Tables already here

When tables with the app's names already exist on this database, the review says "3 tables already
exist here with these names." and offers **Use the existing tables**. It uses every one of them as
it is, with its rows. It never renames one, and it changes none. After you press it, the review reads
"3 used as they are · 0 changes to them".

This is the way to install an app onto a copy of the database it was saved from: nothing is created,
and the install plans no schema change at all.

A table that cannot be used as it is (a column the app needs is missing, or has another type) stops
the install: "orders can't be used as it is." with the reason, and "Rename the table here, or save
the app again without it." There is no button that leaves the table out, because the app's pages
and rules need it.

### Pages whose names are taken

When a page here already has the address one of the app's pages uses, the review lists each one,
says whether the page here is as Adminium made it or was changed here, and offers:

- **Replace it**: only for a page nobody edited. The app's page takes the address.
- **Rename the page here**: the page here moves to a new address (by default `<page>-old`), and the
  app's page takes the address.
- **Skip it**: the page here stays, and the app's page is not made.

Install waits until each clash has an answer: "Choose what to do with Orders and Customers."

### Rules that send data out

A rule in the file that calls a web address or emails a fixed address is listed under **These rules
would send data out**, each marked **Off**. Whatever the file says, such a rule **arrives switched
off, with its address empty**. Someone who manages automations fills in the address and turns it on.
A file can never make this server send data somewhere on its own.

### The look and languages

When the file carries [the deployment-wide part](/guides/your-own-apps/save-as-app/#the-deployment-wide-part),
**Also apply the look and languages** is offered, off by default. Only someone who manages server
settings can tick it. **What's in it** lists the logo and colours, languages switched on, edited
wording and system emails. Each edited email has its own tick, a tick for each place its links go,
and **Show changes**. Passwords, keys and email server settings are never in the file.

### Screens

A file with screens of its own says so: "They run with the rights of whoever opens them. Install it
only if you trust who saved it."

### After you install

The things the owner must fill in, because they never travel: web addresses, fixed addresses,
document recipients, sender addresses, payment keys and bank accounts, and roles' console rights.
"These stay on the app's page until they are done."

## Done

Done names the version and the database ("Fernhill Ops 1.2.0 is installed on kiln"), how many rules
that send data out arrived switched off, and how many things there are to do, with **Open the app's
page**.

## The app's page

An app of your own reads **Your own app** on Hosted apps and on its page, with "Made at *label* on
*date*". Its page differs from a released app's in a few ways:

- **Upload a newer version** replaces Update: a self-made app is never in the online catalogue, so
  a newer version always comes as a file.
- **After you install** is the first card on the right: each item with a link to where it is done
  ("Open the rule", "Open email settings", "Open roles"…), "2 of 5 done", and who ticked each one.
  An item the server can see is done ticks itself. An item you lack the right for is locked, with
  who can do it. When everything is done, **Hide** puts the card away.
- **The look and languages**, when it was applied: what it changed and when. **Undo**, for someone
  who manages server settings, puts back what was here before. A group someone changed since is left
  as it is.
- **What it added**: pages, email templates, scheduled reports and roles, and how many of its tables
  were here before the app.
- **Sets of screens** shows only when the app has screens.
- **Uninstall** says what goes: the app's pages and rules. The tables and their rows stay, as for
  any app.

## Updating

Upload a newer file of the same app (from **Upload a newer version**, or **Install an app**). The
upload sees that the key is installed and offers the right thing:

| The file is | What is offered |
|---|---|
| **Newer** than the copies here | **Update every copy (fernhill and kiln)**, then optionally **Also install on another database** |
| **The same version** | **Install on another database** |
| **Older** | Refused, per database: "fernhill already has 1.1.0. The file is the older 1.0.0." |

An update runs through the same review, one copy at a time: "Update Fernhill Ops on kiln to
v1.2.0", "Copy 2 of 2 · 1.1.0 → 1.2.0". Only that copy changes in its dialog; its settings, roles
and email templates are kept. Pages follow the new version, except pages someone edited here, which
are kept. A new rule that sends data out arrives switched off and empty; one already here keeps its
address. The After you install list follows the version too: items the new version no longer has
go.

Cancel stops the rest. The button then reads **Update the rest (kiln)**.

### An update that stops part way

An update that stops after its version moved, for example while writing pages, keeps what it did:
"The update to 1.2.0 stopped while writing pages. Nothing was lost; 1.1.0's pages are still here."
**Finish the update** runs it again and carries on from where it stopped. The notice stays on the
copy's row on Hosted apps after a reload, so a closed tab never leaves a half-finished update
behind.

## Installing on another database

The same app can be installed once on each database. Upload the same file again, choose **Install
on another database**, and pick a database that does not have it. The new copy gets its own
settings, roles and email templates, and the copies already here are not touched.

Every copy runs the same version. To install a newer file on another database, update the copies
first: the upload offers that.

For what each copy keeps to itself, and how its addresses are made, see
[An app on several databases](/self-hosting/apps-per-database/).

## Refusals

Each refusal replaces the review, says why in a sentence, and offers **Back**. Nothing is written.

| Refusal | Why | What to do |
|---|---|---|
| **Saved from this database** | The file was saved from this database on this server. Installing it there would run every automation twice. | Pick another database, or try it on a test server. |
| **An older file** | Every copy here runs a newer version. | Upload the newer file, or nothing. |
| **A different app with this key** | This server already has a different app under this key, saved somewhere else. The key names one app across the whole server. | Save the other app again with another key. |
| **Needs a newer Adminium** | The file uses something this Adminium does not know ("This file needs Adminium 0.3.49 or newer. This server runs 0.3.48."). | Upgrade this server. |
| **Installed on every database** | Every database here already has this version. | Connect another database, or nothing. |
| **One version per app** ("kiln has Fernhill Ops 1.1.0, and every copy of an app runs one version") | You picked a database for a different version than the copies here. | Update the copies first, then install this one. |

Two older rules still hold for every self-made app: it cannot replace an app from another
publisher (`PUBLISHER_CHANGED`), and it cannot take the key of an app the online catalogue lists
(`KEY_IN_CATALOG`).

Through the API, these arrive as codes: `SAVED_FROM_HERE`, `VERSION_OLDER`, `LINEAGE_DIFFERS`,
`REQUIRES_NEWER_ADMINIUM`, `ONE_VERSION_PER_APP`, `EXISTING_TABLE_UNUSABLE` and
`PAGE_SLUG_UNANSWERED`.

## What a file can never do

Nothing in a file changes Adminium itself, and nothing in it can do more on this server than the
person installing it could do by hand:

- rules that send data out arrive off and empty, and only someone who manages automations turns
  them on;
- the look and languages are applied only by someone who manages server settings, and never write
  a setting that holds a secret;
- roles in the file get no `system:` rights and no "every table" grant, only the app's own tables
  and pages;
- a page or a table is found through the app's own names, never a table the file names directly,
  and never a database's system schema;
- the file carries no code that runs on the server.
