---
title: Save as app
description: Turn what you built on one database into an app file of your own, install it on another Adminium, and keep a record of every version you saved. What travels, what never does, Check, rows, the fingerprint and who may save what.
---

You built something on one database: tables, pages, roles, rules, mails, documents. **Save as
app** turns it into an ordinary app file (a `.tgz`) that any other Adminium installs through
**Install an app**, the same way it installs a released app. The tables are created there (or the
ones already there are used), and the pages, roles, rules, mails and the rest are put in place.

Saving changes nothing on this server. It reads what is there and writes a file.

The file is an app like any other, with the publisher `local`. Installing it is covered in
[Installing your own app](/guides/your-own-apps/install/).

## Where to start

**Save as app** sits in two places:

- On **Studio → Hosted apps**, beside **Install an app**. With more than one database it asks
  **Save which database?** and lists each database once, with its engine and table count.
- On a connection's card on **Data connections**, after **Regional settings**. It opens Hosted apps
  with that database already picked.

Both open the **quick save**: one dialog with the app's name, key and version, a count of what goes
in ("12 tables, 30 pages, 3 roles, 4 automations and 9 more things"), and a line that says
**Ready to save** or how many things need a choice. Everything on the database goes in, without
rows. **Save** saves. **More choices** opens the full wizard with what you typed kept.

The wizard has five steps: **Database**, **What to include**, **About the app**, **Check** and
**Download**.

One app describes one database. To put several databases in one file, save their workspace
instead: see [Workspace files](/guides/workspaces/files/).

## What travels

| What | How it travels |
|---|---|
| Tables | Columns, types, keys, unique rules, indexes and foreign keys. The labels, rules and options you set on them go along. |
| Links you added in Adminium | As links with no foreign key, exactly as they work here. |
| Pages and dashboards | A page nobody changed travels short, and is made again on the new server. A page someone changed travels as it is, with its columns, order, sort and widgets. |
| Saved views | Shared views go along. A person's own view goes only if you make it shared in the app (see [Check](#check)). |
| Roles | Your own roles, with their grants on the app's tables and pages. A role that may use every table is narrowed to the app's tables, and Check says so. Built-in roles stay behind. |
| Automations | Their steps and conditions. Web addresses, header values and fixed email addresses never travel. |
| Email templates and campaigns | The templates the app uses and the campaigns you choose, in every language, with their attachments. Built-in templates stay behind. |
| Documents, reports, invoice layouts, scheduled reports | As they are. Who receives them is chosen again on the new server. |
| Payments setup | Which tables take payments, and how. Payment keys never travel. |
| Public access | Endpoints and scopes, exactly as they are, or not at all. Keys are made fresh where the app is installed. |
| Add-ons the app uses | Named in the file, so the new server installs them first. |
| Option lists | With their descriptions. |
| Translations | The labels and names of what travels, in every language you wrote them. |
| Files the setup points at | Logos and pictures the pages, mails and documents use. |
| Rows | Only where you choose them (see [Rows](#rows)). |

A self-made app may keep a table's real name and, on Postgres, its schema. Tables are not given a
prefix, so `orders` stays `orders`.

### What never travels

- **People, teams and sessions.** The new server has its own.
- **Secrets of any kind.** Database passwords, API keys, SMTP and payment keys, DKIM keys, webhook
  addresses, tokens. Before the file is written, Adminium looks for every secret this server holds,
  in every form it could take inside the file (see [Check](#check)).
- **History.** Audit entries, runs, sends, logs.
- **Rows you did not choose.**
- **What an installed app owns.** If an app from adminium.dev made a table or a page, the file names
  that app as one it needs (`apps.requires`). The new server must have it installed on that
  database first.
- **Server code.** A file never carries anything that runs on the server.

## What to include

Everything is grouped by kind, with a count beside each group and a search box: tables, pages,
roles, automations, email templates, documents, reports, invoice layouts, scheduled reports, public
access, saved views and the payments setup. Groups start folded.

- **Ticking an item brings in what it needs.** Tick a page and its table comes too. The line under it
  says what came with it: "Brought in with it: orders, customers".
- **Unticking something another item needs asks first.** The dialog **Other things use orders**
  lists everything that would lose what it points to, grouped by kind. **Leave them all out** takes
  them out too. **Keep the columns, drop the links** keeps the tables that link to it, without the
  links. **Keep orders** cancels.
- **This server's look and words** is its own item, off by default. It is the logo, the colours,
  which languages are on, changed wording, edited system emails and a few plain settings. See
  [The deployment-wide part](#the-deployment-wide-part).

## Rows

Each table has a rows control beside its row count:

| Choice | What it is | On the new server |
|---|---|---|
| **Nothing** | The default | The table is empty |
| **Starting rows** | Up to 200 rows | Written once into an empty table. From then on they are the owner's rows. |
| **Sample rows** | Up to 5,000 rows | Added as [sample data](/guides/apps/sample-data/), which the owner can remove in one go |

When a table has more rows than that, the control reads "4,812 rows — choose which 200". Pick them
by **The page's order**, or by a saved view of that table.

Rows keep their ids. They only ever go into empty tables, so they cannot clash with anything, and
config that points at a row by its id still points at the same row. Parents are written before the
rows that point at them.

### Personal columns

A column marked personal, or one whose name looks like a secret (`token`, `api_key`, `password`,
`secret`…), is **left out of the rows** unless you include it. Its chip says "Personal: email,
phone — left out" with **Include them**. The column itself still travels; only its values stay
behind.

If every row needs a value in such a column, Check asks you to include the values or leave that
table's rows out.

## About the app

- **Name** and **Description**, as people read them where the app is installed.
- **Key**: 2 to 80 lower-case letters, digits and `-`, starting with a letter. It names the app on
  every server. A key that belongs to an app on adminium.dev is refused. So is a key you already
  saved from another database on this server.
- **Version**: the last saved version plus one (`1.0.0` the first time, then `1.0.1`). You may type
  a higher one. A version already saved is never saved again, and an older one is refused.
- **Icon**: one of twelve, or none.
- **Made at**: a name for where the app was made, shown on the new server's review and on the app's
  page. It starts as this server's name. Use a name, not an address: a host name or URL is refused.

## Columns under their own names

A column of a self-made app keeps the name it has in your database. `orderDate`, `Order Total` and
`driver-name` travel as they are, and the new server creates them under the same names. Every part
of the file names the column the same way: pages, views, roles' column limits, rules, public
access and rows.

A name may start with a letter or `_`, then hold letters, digits, `_`, `$`, `-` and spaces. A name
the file cannot hold, such as one with a dot or a colon, is a question in Check: leave the column
out, or rename it here first. Two columns whose names differ only by upper and lower case are
refused, because some databases treat them as one.

Apps from adminium.dev and add-ons still use snake_case. Two places take only names without spaces:
a formula's `join`, and the short path rules (a staff column, a night count).

The new server must run Adminium 0.3.49 or newer to install such a file.

## Check

Check runs on a trial file, before anything is written. It sorts what it finds into groups. A
group with nothing in it is not shown.

### Blocks saving

- **A saved secret of this server.** "Automation ‘new-order-hook’ · url · holds a saved secret of
  this server." Check names the kind, the item and the field. It never shows the value. Answer
  **Clear this field** (the field is empty in the file) or **Leave it out** (the item stays behind).
- **Something that cannot be in an app file at all**, such as an id of this server, a file over
  32 MB or a file that would not install. Each says why, with **Back to What to include**.

The secret scan reads every secret this server keeps sealed (connection passwords, storage keys,
mail and AI keys, DKIM keys, payment keys, tokens, and the project's `.env`), and looks for each one
in the file whole, in pieces, and encoded (escaped, URL-encoded, base64, base64url and hex). A new
kind of secret added to Adminium fails a test until the scan covers it.

### Needs a choice

Save waits until each one is answered.

- **A column with no matching type.** **Carry as text**, or **Leave it out**.
- **A table keyed by several columns together.** **Keep them unique together** (the columns stay
  unique as a set, and the table has no key), or leave the table out.
- **A column name the file cannot hold.** Leave it out, or rename it first.
- **A page that shows a table not in the app.** Leave the page out, or put its table in.
- **Saved views that belong to people.** They are listed together, each with a **Make shared**
  switch. A view you make shared goes in as a shared view of the app. Here it stays as it is. Views
  start "0 of N" shared, and a view left unshared stays behind without holding Save.
- **An email with no US English text.** An app's mail needs one. Leave it out, or write one first.
- **Rows that need each other.** Rows of two tables that point at each other through required
  columns: leave the rows of one of them out.
- **A value that looks like a key** but is not one this server holds. **Clear this field**, or
  **It is not a key**.

Each answered item says what the file will hold and that nothing on this server changes, with
**Undo**.

### After you install

What the owner of the new server fills in, because it never travels. The new server keeps this list
on the app's page until each item is done.

- the web address and header values of a rule that calls a web address;
- the fixed addresses a rule emails;
- who receives a document or a scheduled report;
- the sender address of each email template;
- payment keys and bank accounts;
- a role's console rights (`system:` grants never travel, so they are listed by name).

### For your information

- Roles that may use every table, narrowed to the app's tables.
- Built-in roles that stay behind. Changes you made to them do not travel.
- **Needs Adminium 0.3.49 or newer**: the oldest Adminium that can install this file.

## Download

The last step names the file `<key>-<version>.tgz`, shows its size and its **fingerprint**, and
offers **Download**.

### The fingerprint

The fingerprint is the file's sha512 hash, written `sha512-` followed by base64. **Copy** puts it on
the clipboard. Keep it with the file, or send it separately to whoever installs it.

On the new server, the review offers **Check against the fingerprint shown when it was saved**. If the
pasted fingerprint does not match the file, Install stays off. A file changed on the way, or a
different file with the same name, cannot be installed by mistake. Nobody signs the file: the
fingerprint is how you know it is the one you saved.

## Saved from here

**Saved from here**, on Hosted apps, lists every app saved on this server: name, key, version,
when, by whom and from which database. Each row has:

- **Copy fingerprint**;
- **Download again**: the same file, byte for byte (the file is kept in the Files library);
- **Save a newer version**: the wizard on the same database, at the next version, with the last
  save's name, description and icon.

Workspace files saved here are listed under it. See [Workspace files](/guides/workspaces/files/).

## The deployment-wide part

The file can carry this server's look and words: the logo and colours, which languages are on,
wording you changed, system emails you edited (invitation, password reset and the like), and a few
plain settings from a fixed list. No setting that holds a secret is ever part of it.

It is off by default. On the new server it is applied only when someone who manages server settings
ticks **Also apply the look and languages** on the review, and each edited email's links are ticked
one by one. What it replaced is recorded, so **Undo** on the app's page puts it back.

## Who may save what

| Saving | Needs |
|---|---|
| The app itself (configuration only) | **Install and manage apps and add-ons** |
| The rows of a table | Your own right to read and export that table, and to read every row of it |
| The values of a personal column | **See personal data in records** on that table |
| Files other people uploaded | **Manage everyone's files** |
| This server's look and words | **Manage server settings** |

Without the first, Save as app is not offered. Without the others, that part cannot be ticked, and
the screen says why: "You can't read orders, so its rows can't go in. Its structure still can."

## Apps with screens of their own

An app you made in [a project](/projects/apps/) already is an app, with screens of its own. On a
project server, its row on Hosted apps (and on the Designer's home) has **Download**. It packs the
folder as `adminium app pack` does, with a version no lower than the folder's manifest, and shows the
fingerprint. The file carries the screens' source, stripped of anything that runs when it is built:
build settings, bundler configs, `package.json` scripts and hidden files.

On another project server, **Make it editable here** on the app's page copies that source into
`apps/<key>/`, so the Designer can change it. From then on the app comes from that folder, and newer
files of it cannot be uploaded. It is refused when the folder already exists, and when the app is
installed on more than one database.

An app from adminium.dev is never repacked.

## From the command line

[`adminium app save`](/reference/cli/#app-save) makes the same file from the command line, with
host access. Answers to Check go in an `--answers` file, and `--plan` prints Check and writes
nothing. [`adminium workspace save`](/reference/cli/#workspace-save) does the same for a whole
workspace.
