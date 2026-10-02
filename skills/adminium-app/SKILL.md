---
name: adminium-app
description: Create or change an Adminium app in a project folder — its manifest written as part files (tables, dashboard pages, roles, public access, sample data), checked, tried on a throwaway Adminium and packed into an installable file. Use when someone wants a new Adminium app, a table or page added to one, a manifest fixed, or an app made installable. Open the `adminium` skill first if you have not.
license: AGPL-3.0-only
---

# An Adminium app

An app lives in the project's `apps/<key>/` folder. Its **manifest** says what it is. You write the
manifest as small part files; Adminium composes them into one document and validates it exactly as
an install does.

The verbs (**new**, **check**, **build**, **try**, **pack**) are commands: see `commands.md`.

## 1. Start from the starter, never from a blank file

Run **new** with a key (lowercase letters, digits and `-`; it becomes the folder, a part of every
table name and of the address the screens are served at). Add `--staff` and/or `--customer` only
if the request needs screens.

It writes a working app and checks it:

```
apps/<key>/
  manifest/app.json                 key, name, version, publisher "local", frontends, navGroups
  manifest/tables/items.json        a table: one file per table, named after its "ref"
  manifest/tables/requests.json
  manifest/pages/<key>-items.json   a dashboard page: one file per page, named after its "ref"
  manifest/pages/<key>-requests.json
  manifest/roles.json               the roles the app adds
  manifest/access.json              what customers may reach (only with --customer)
  manifest/sample.json              names seeds/sample.json
  seeds/sample.json                 sample rows
  staff/  customer/                 screens (only when asked for)
  tests/app.test.mjs  README.md     run the test with  node --test apps/<key>/tests/app.test.mjs
```

Then shape it into what was asked: rename and rewrite the tables, pages, role and sample rows.
Delete what the request does not need. Keep `publisher` as it is.

## 2. Which file holds what

Read `references/projects/apps--the-manifest-as-parts.md` for the full table. In short: everything
about the app itself in `app.json`; one table per file; one page per file; `roles.json`,
`settings.json`, `option-lists.json` and `documents.json` are the bare array or object;
`access.json`, `emails.json` and `sample.json` are objects holding their named fields.

A file that is not a part is an error. A table or page file must be named after its `ref`.

## 3. Write the manifest from the references, not from memory

Open `references/INDEX.md`, find the task, read that one file.

- `references/guides/manifest-by-task--*.md`: add a table, link two tables, a choice column, a
  page, a role, customer access, sample data, settings, emails. Start here.
- `references/manifest/*.md`: the full reference, split by section, when the task guide is not
  enough.

Rules that catch people:

- A column with no `default` that is not `nullable` is required on every new row, and **check**
  prints a `!` for it (unless a rule fills it). Give it a default or make it nullable. When you
  mean it to be required, leave it: a `!` is advice, the check still passes, and you say which
  ones are meant.
- A page's `ref` is its address in the dashboard and is shared by every installed app. Start it
  with the app's key.
- A page's `nav.group` names a `key` in `app.json`'s `navGroups`; one that names none is listed
  with no heading.
- A `page-board` needs a status column with at least two of Adminium's workflow words as values
  (`new`, `in_progress`, `done`, …; the list is in the page task guide). Otherwise the page is
  created empty and **try** fails on it: use those words with your own labels, or `page-crud`.
- An `fk` column's `references` must be the `ref` of a table of the app. **check** does not catch a
  wrong one; the install does, so **try** does.
- A role may grant only things inside the app: `table:@<table>:read|create|update|delete`,
  `page:@<page ref>:view`, `app:@:staff` (open the staff screens). `@` stands for this app. A role
  sees a page in the sidebar only with that page's grant, and reads a person's name, phone or
  email as empty without `table:@<table>:read_pii`.
- `access.json` is the only thing customers can reach. A table anyone may add a row to (`POST`)
  may not also be one anyone may read (`GET`): put reading and adding on different tables.

## 4. Check after every change

**check** prints `✗` for what an install would refuse, with the file and field; `!` for advice;
then the app in one line and what the customer side may reach. Fix every `✗`. Read the access
lines back to the person: that list is the app's whole public surface.

## 5. Sample data

`seeds/sample.json` (format `adminium.sample/1`) holds a few believable rows per table, parents
before children. Keep it small. It is added only when the person installing asks for it, and
**check** validates it against the tables.

## 6. Prove it, then pack it

**try** packs the app and installs it on a throwaway Adminium with an empty database: upload, table
check, install, sample data, then each side and the public API are probed. Every line must be `✓`.
A `✗` carries the server's own words; fix that and run it again.

**pack** writes `.adminium/packs/<key>-<version>.tgz` and its fingerprint. Tell the person how to
install it: Studio → Hosted apps → Install an app, upload the file, paste the fingerprint (the
contents of the `.integrity` file). Raise `version` in `app.json` before packing a change to an
app that is already installed: an update needs a higher version.

## 7. Say what you built

End with: the rung, the tables and pages, the roles, what customers may reach (from **check**), the
result of **try**, where the pack is, and anything asked for that Adminium cannot do.

## What an app cannot do

- Carry server code. Hooks and actions stay in the project (`adminium-project`).
- Be installed from a catalogue. It is `local`: it installs from its file.
- Have no table or no page. A manifest needs at least one of each.
