---
title: Whose a row is
description: Hold a role to the rows a person owns, their team's, or the ones nobody owns yet, and know exactly what that does and does not cover.
---

A role's right on a table normally reaches **every row** of it. A role can instead be held to
**some rows**, separately for reading, changing and deleting:

- **Their own rows**: the rows the person belongs to.
- **Their own rows, and their team's**: also the rows of people in a team the person **leads**.
- **And rows nobody owns yet**: on top of either, the rows no person belongs to (a shared inbox).
- **Only while**: only while a column of the row holds one of a list of values (an account manager
  reads deals while they are won). An app sets this in its manifest; it is shown on the role, and
  kept when you change the rest.

A row a person does not reach is, for them, a row that is not there: it is missing from lists,
counts, search, charts and files, and asking for it by its key answers "not found", exactly as a
key that does not exist. They cannot hang a record on it either: a follow-up on a colleague's
deal is refused in the words of "no such deal".

## How a table says whose a row is

Only a table that says how people belong to its rows can be limited. There are three ways, and a
table may use several (any one is enough):

| Way | Says | For example |
|---|---|---|
| A **staff column** | "the person in Owner" | a deal's owner, a follow-up's owner |
| A **listing** in another table, which may have dates | "anyone listed for this row" | helpers added to a deal; whoever covers a colleague between two dates |
| **Its parent** | "whoever reaches its deal" | a quote, its lines, the notes on a deal |

An app declares this in its manifest ([`belongs`](/reference/manifest/#whose-a-row-is)). A table
that says nothing is everybody's who holds the table.

## Limiting a role

**Settings → Roles & permissions**, then **Rows** beside a role. The dialog lists every table the
role may open that says whose its rows are. For each it says how, in words, and offers Read,
Change and Delete (the ones the role holds), each as *Every row*, *Their own rows*, or *Their own
rows, and their team's*, with a tick for *and rows nobody owns yet*.

Choose a person under **Try it as** and each table says how many rows that person would see
("Dana would see 6 of 14"), before you save.

Two things to know:

- **A limit holds for a person only when every role that gives them the table is limited.** A
  second role with a plain grant lifts it. The dialog says so for the person you try it as.
- Two limited roles are not blended. Each is its own test, and a person reaches a row when any
  one role's whole test passes.

Super Admin reaches every row and cannot be limited.

## What a write may name

A row is hung on another by a link, and a link could walk round a limit: a follow-up attached to
a colleague's deal is a row made inside a record its writer cannot see. So a link is judged when
it is written, for a table that says whose its rows are:

- **Somebody who reads the linked table in part** may name a row they reach.
- **Somebody who does not read the linked table at all** may name a row that is theirs by that
  table's own ways, and no other. A fitter who reads no job cannot write a sign-off against a
  job by its key; the app lets the sign-off find its job through the visit, which the fitter
  does read.
- **Somebody who reads the linked table whole** names any row, as ever.

A link that is refused is refused exactly as a link to a row that is not there. Only a link this
write sets is asked about: one the row already holds is left alone. A file brought in is judged
the same way, row by row. A table that says nothing of its rows is not judged: its key is a key.

When you design an app, give a role that must hang rows on a record a way to reach that record
(a read with a limit, or a link through a row they do reach), or let a rule make the row.

## Teams

**Settings → Team → Teams.** A team is a named set of people, and some of its members **lead**
it. A lead reaches the rows of everyone in the teams they lead; a member reaches no more than
their own. A person may be in several teams, and leading one says nothing of another.

Adding yourself to a team as its lead is giving yourself its rows, so teams are managed by
whoever may **manage users**, reading included.

One person's reach holds at most 2,000 people. The Teams card says so when somebody leads more.

Rows follow the person. When someone changes team, their rows go with them at once, and their
old lead stops reaching them.

## When a person leaves

Suspending an account changes nothing about its rows, unless you say who takes them.

Deleting an account **permanently** first looks for rows that are the person's. If there are
any, the dialog lists them by table and asks who takes them. The removal names that person, and
the server hands the rows over itself once it has agreed to the removal, so no row moves for a
removal that is then refused. Without somebody to take them, the delete is refused.

What counts and what moves is narrow on purpose:

- **Only the columns that decide whose a row is**: the staff columns a table's own ways name. A
  column that records who approved or who made a row is history. It is not counted, and it
  keeps the leaver's name.
- **Only as a person is suspended or removed.** While somebody is here their rows are theirs; a
  single row changes hands through its table's own hand-over button, judged and recorded row by
  row. A suspended person's rows can also be handed on afterwards
  (`POST /api/v1/users/{id}/rows/hand-over`).
- **Only to somebody who is here and can open them**: an active person whose roles read every
  table a row of which would become theirs. Otherwise the hand-over is refused and says which
  tables they cannot read. You may take the rows yourself.
- **A Super Admin's rows** are handed on by a Super Admin only.
- **One audit entry for each table**, with how many rows moved and to whom.
- A database's rows move together or not at all. One that could be counted and not written is
  named in the reply, apart from one that could not be read.

## Private tables

An app may mark a table **private**: its rows are read by the people each row belongs to, on the
screen, and by nobody and nothing else. That includes Super Admin, rules, exports and imports,
scheduled reports, documents, public entries, an owner's own code and the assistant's figures.
A private table's rows are never handed over when a person leaves: a one-to-one stays with its
two people. Whoever removes the person is told only that such rows exist, never how many or in
which table. Only the app's own update can set or remove the mark, and the update's plan says
when it does.

## What a row limit does not do

- **Rules run as the system.** A rule, its notices, emails and webhooks are not held to a
  person's rows: whoever writes a rule decides who is told what. To save, switch on, copy or
  test a rule on a table, its author must reach every row of that table.
- **A stored total is every row's.** A count or a sum kept on a parent row is written whole. An
  app's manifest is refused if it keeps such a total where a role reads only some of the rows
  it adds up; the app works the figure out when it is read instead.
- **A kiosk and a public entry** read with their key's scope, not with a person's rows.
- **An owner's own code** reads whole (never a private table).
- **A unique value still tells that it exists.** "That number is taken" is said to everybody.
- **The assistant's kept conversations** keep what their owner saw at the time.
- **The audit list** leaves out entries of a table its reader is limited on; a row's own history
  is read through the row.
- **A file out of a table** (an export, a kept document) belongs to whoever asked for it; managing
  exports does not open another person's file of a table you are limited on.
- **An API key is nobody.** A key whose role is limited on a table reads no row of it.
- There is no sharing of one row with one named person outside a listing, and no teams inside
  teams.

## A live screen

An open list hears about changes as they happen. A person held to some rows hears about their
own rows only. When a row of theirs is handed to a colleague, their screen lets go of it at once;
a colleague's work is never announced to them.
