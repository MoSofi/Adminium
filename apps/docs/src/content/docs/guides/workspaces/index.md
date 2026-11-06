---
title: Workspaces
description: Group a server's databases into workspaces, one per team or business. The two menu views, the current workspace of each tab, Other databases, managing them, "Shown in", and what a workspace is not.
---

A **workspace** is a named group of databases on one server. It is how one Adminium serves more
than one team or business without their menus running together.

- **One company, several databases.** Fernhill Coffee runs `fernhill` and `fernhill_archive`. Both
  sit in the workspace "Fernhill Coffee" and share one menu.
- **Unrelated businesses on one server.** Kiln Street Pottery (`kiln`) has nothing to do with
  Fernhill. It is a workspace of its own, with its own copies of apps
  ([apps per database](/self-hosting/apps-per-database/)) and its own
  [mail sender](/guides/workspaces/senders/).

A database may sit in several workspaces (a shared `suppliers` database in both), or in none.

**A server with no workspace looks exactly as it did before.** Upgrading creates none, and nothing
about the menu changes until someone makes the first one.

:::caution[A workspace is not a security wall]
Workspaces organise the menu. They do not decide who may see what: **roles do**, as before. Read
these three points before you put two businesses on one server.

- **Rights stay with roles.** A role's grants name tables of a database, and they work the same
  whether or not that database is in a workspace. A person who may read a table of `kiln` can read
  it from any workspace view, by a link, or through the API.
- **A shared database shows every one of its workspaces.** Someone who reaches a page of the shared
  `suppliers` database sees both workspaces it sits in, "Fernhill Coffee" and "Kiln Street
  Pottery", in their menu. The names of the other business's workspace are not hidden from them.
- **`system:` grants reach every business on the server.** Refunds, privacy requests, other people's
  files, the audit log and exports are server-wide rights. Whoever holds one holds it for Fernhill
  and Kiln alike.

When two businesses must never see each other's data, give each its own roles with grants on its own
databases only, or run two servers.
:::

## The two views

How the menu shows workspaces is one choice for the whole server, made by an administrator:
**Workspaces in the menu** on **Global defaults**, or the toggle in the workspace menu itself
(shown to people who manage server settings, with "Applies to everyone on this server.").

| View | The menu |
|---|---|
| **All in one menu** (the default) | The card at the top reads "Server" and the server's name. Below it, one folding block per workspace you can see, then **Other databases**. |
| **One at a time** | The card shows the current workspace: its tile, "Workspace" and its name. The menu shows that workspace's block only. Open the card to switch. |

All in one menu is the default so that nobody's pages vanish from their menu when someone makes a
second workspace.

In both views:

- **A block holds everything about its databases**: their pages from every group (the generated
  pages, Planning boards and calendars, pages placed in Library or People), sectioned per database
  when the block has two, and then the sections of the apps and add-ons installed on them.
- **After the blocks, once:** a **Shared** group (pages with no database, server-wide add-ons, and
  app links with no install), then the rows that belong to the whole server: Library, People,
  Planning's own links and Account.
- **With only one group you can see, there is no card and no block header.** The menu is the plain
  one, as before.

### The workspace menu

Opening the card lists "Workspaces on *server*": one row per workspace you can see, with "3
databases · Postgres, MySQL", and Other databases last. In One at a time the current one has a tick;
choosing another switches this tab. In All in one menu choosing one unfolds its block and moves
focus to it. **Manage workspaces** opens Data connections, for people who manage connections.

### A page in two workspaces

A page of a database that is in two workspaces appears in both blocks of All in one menu. Only one
copy is the current page: the one in the tab's current workspace. The other copy is a plain link,
and a screen reader hears "also in Fernhill Coffee". The command palette lists the page once.

## The current workspace

Each browser tab has its own current workspace, so two tabs can work on two businesses side by side.

- A new tab starts in the workspace you chose last. The server remembers that choice for you.
- The tab keeps its own choice until you switch. Signing in as someone else does not carry it over.
- **A link switches when it has to.** Opening a page, a record or an app's screen of a database the
  current workspace does not hold moves the tab to the first workspace that does, and says
  "Switched to Kiln Street Pottery". A link to a database the current workspace holds keeps it. A
  server-wide page (People, Settings) never switches.

## Other databases

Once at least one workspace exists, databases that are in none form one more group, **Other
databases**. It is not a workspace: it cannot be renamed or deleted, and it always comes last. It
goes away when every database belongs somewhere.

## Who sees a workspace

You see a workspace when the menu gives you at least one page of its databases, or a hosted app's
screens installed on one of them, or when you manage database connections. The same rule applies to
Other databases. There is no new right to grant.

A person whose pages are all in one workspace sees no card and no switcher: their menu is the plain
one.

## Library pages follow the view

In **One at a time**, these pages list what belongs to the current workspace, with its chip by the
title. In **All in one menu**, they list everything once, with a **Workspace** filter and, where the
rows carry a database, a **Workspaces** column of chips:

- automation rules and their workflow logs;
- files;
- data exports;
- the audit log;
- Studio's page list;
- email templates and report layouts (through ["Shown in"](#shown-in)).

**People, Teams and Roles never filter**: they belong to the whole server. **Data connections always
lists every connection**, with a Workspace filter that starts at All, because it is where workspaces
are managed.

Through the API, list routes take `?workspaceId=<id>` (or `other`). It only narrows: the list with it
is always part of the list without it, every check stays the same, and a workspace you cannot see
answers `404`.

## Managing workspaces

Workspaces are managed on **Studio → Data connections**, and every change needs **Manage database
connections**. Every change is audited and reaches everyone's menu at once, without a reload.

- **The Workspaces card** has a row per workspace: its tile, its name, "2 databases · fernhill,
  fernhill_archive", and **Rename**, **Delete**, **Sender** and **Save workspace**. **New workspace**
  adds one. Drag a row by its grip, or use the arrow keys on it, to reorder them. The order decides
  the menu's order, which workspace a link switches to, and which sender a shared database's mail
  uses.
- **New workspace** asks for a name (unique, at most 80 characters) and at least one database. Its
  tile shows the first letters of its name.
- **The first workspace changes everyone's menu.** Creating it says so: "Everyone's menu groups by
  workspace from now on. Databases in none show under Other databases."
- **Each connection's card** shows its workspace chips, or Other databases, and has
  **Workspaces…** after Rename: a checkbox per workspace, and **New workspace…**. Its pages and apps
  show in each workspace you tick. Nobody's access changes.
- **Adding a connection** asks which workspaces it goes in. In One at a time the current workspace
  is ticked. Tick none to put it in Other databases.
- **An empty workspace** (its last database removed) stays, reads "0 databases" and leaves the menu
  until it has a database again.
- **Delete** is always offered: "Its databases stay. They leave this workspace." It lists any email
  template or layout shown in that workspace alone (see below). Deleting the last workspace puts
  everyone's menu back to one list.
- **A connection that holds an installed app cannot be deleted.** Uninstall the app from it first:
  "Remove Invoices & Receipts from kiln first." (`CONNECTION_HAS_INSTALLS`).

**Sender** sets [a mail sender for the workspace](/guides/workspaces/senders/). **Save workspace**
saves its databases as [one file](/guides/workspaces/files/).

## Shown in

Email templates, campaigns and report layouts belong to the whole server, but a business usually
wants to see only its own. **Shown in** narrows where one is listed:

- **All workspaces**: the default, and what every item already had.
- **Only these workspaces**: a list of workspaces to tick. Ticking none lists it nowhere.

It is at the end of the **Brand & sender** panel of the email editor, and of the header panel of
the report builder. The lists show a **Shown in** column ("All workspaces", or a chip per
workspace) and the Workspace filter. Invoice layouts take the same setting through the API
(`PATCH /invoices/:id` with `shownIn`).

**Shown in narrows lists and pickers, never sending.** The template pickers of rules, digests and
campaigns offer what is listed in the tab's workspace. A rule that already names a template hidden
here keeps it, shows "Not listed in Kiln Street Pottery. Anything that uses it still sends it.",
and still sends it.

An email template is set for all its languages at once. A copy of an item starts where its source is
shown. When a workspace that is an item's only "Shown in" is deleted, the item is listed in no
workspace afterwards: it is never widened to all. The delete confirm lists those items first.

## What belongs where

| Follows its database's workspaces | Server-wide, narrowed by "Shown in" | Server-wide, always |
|---|---|---|
| Generated pages and their saved views | Email templates and campaigns | People, teams, roles, API keys |
| App and add-on installs, and their menu sections | Report layouts | Payment settings and payment-provider add-ons |
| Automations and their runs | Invoice layouts | Marketplace, Settings, Global defaults, branding |
| Files, document profiles, public scopes and endpoints | | Shared pages |
| Imports and exports | | The do-not-email list |
| Audit entries that name a database | | Audit entries that name none, and `system:` grants |
| The sender of mail about its records | | The server's own sender |

## What workspaces are not

- **Not a security wall.** See the box at the top of this page.
- **Not in `export-zip`.** [Export & restore](/self-hosting/export-zip/) carries connections, pages,
  roles and settings, but no workspaces, their order or their senders. After restoring, make them
  again on Data connections. A [workspace file](/guides/workspaces/files/) carries a workspace's
  name and its apps, but not its sender.
- **Not a new kind of role.** Roles stay server-wide.
