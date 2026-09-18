---
title: Option lists
description: Reusable lists of allowed values — the three built in, making your own, storing the label instead of the code, and what happens to a list that is in use.
---

An **option list** is a named set of values that a column may hold. Attach one
to a column and every form that shows it offers a menu; the server checks
against the same list, so a value nobody can pick is also a value nobody can
send.

**Studio → Option lists.**

## The three built in

| List | What it holds |
|---|---|
| **Countries** | The 249 ISO 3166-1 country codes |
| **US states** | The 50 states, DC and the territories |
| **Gender** | Female, male, other |

Their names are shown in the reader's language; their **values** are the codes,
which is what your column stores. They cannot be edited — but **Make an editable
copy** gives you your own list seeded from one, which can be.

## Making your own

A list is a key, a name and the options. Each option is a **value** — what goes
in the column — and optionally a **label** and a colour.

The value is the contract. Your reports, your exports and anything else reading
the table see it, so a value is worth choosing once and keeping: `shipped`
outlives "Shipped (new process)".

## Store the label instead of the code

Some tables were built to hold `Germany`, not `DE`. Turn on **Store the label
instead of the code** and the column keeps the label while the list still
decides what is allowed.

Turn it on for an existing column only if the rows already hold labels —
otherwise new rows will disagree with old ones, and Adminium cannot tell them
apart.

## Attaching a list to a column

**Studio → Schema → a column → Rules → Option list.** A rule that names a list
is checked against the list that exists: naming one nothing defines is refused
at the save, because a rule that quietly checks nothing is worse than no rule —
the form would promise it.

A column whose own type already fixes its values (a `CHECK` constraint, a native
PostgreSQL enum) does not take a list. The database has already answered the
question, and the answer is shown in Schema → Design.

## A list that is in use

Deleting a list that a column names is refused, by name: the columns using it are
listed so you can remove the rule there first.

Removing a value from a list does **not** change rows that already hold it. They
keep the value, the form shows it marked as no longer in the list, and nothing is
rewritten behind your back.

## Lists in a project folder

Option lists are configuration, so they are part of a
[project folder](/projects/folder/): each one is a file under `lists/`, and
`adminium check` validates them like everything else.
