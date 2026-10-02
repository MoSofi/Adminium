---
name: adminium-project
description: Work in an Adminium project folder — the code-first way to run Adminium — beyond an app's own files. Use for adminium.config.ts and databases, page and schema files, custom dashboard pages and widgets written in React, hooks that run before or after a record is saved, actions that add a button running your code, pulling Studio changes into files, checking and deploying a project.
license: AGPL-3.0-only
---

# The project around the app

A project is a folder with `adminium.config.ts`. It holds Adminium's settings, the generated pages
as files, and your own code. Apps live in its `apps/` folder (`adminium-app`); this skill is about
everything else in it.

The verbs are in `commands.md`. Project commands are run as package scripts: `npm run dev`,
`npm run build`, `npm run check`, `npm run start`.

## What is where

Read `references/projects/folder--*.md` for the whole tree. In short:

| Path | What it is | Reference |
|---|---|---|
| `adminium.config.ts` | Which databases, and the settings | `references/projects/folder--adminium-config-ts.md` |
| `pages/*.json`, `schema/*.json`, `lists/*.json` | Generated pages, labels and rules as files | `references/projects/page-files--*.md` |
| `pages/*.tsx`, `widgets/*.tsx` | Your own dashboard pages, table cells and dashboard cards | `references/projects/pages-and-widgets--*.md` |
| `hooks/*.ts`, `actions/*.ts` | Server code: around a save, or behind a button | `references/projects/hooks-and-actions--*.md` |
| `apps/<key>/` | An app of your own | the `adminium-app` skill |
| `.env` | `ADMINIUM_SECRET` and database URLs | never read it, never print it, never commit it |

## Choosing between them

- A list, a form, a filter, a saved view, a dashboard of numbers: a **page file**, or made in
  Studio and pulled. Not code.
- A screen in the dashboard that the page templates cannot draw: a **page in `pages/*.tsx`**,
  using the UI kit from `@adminiumjs/adminium/ui`.
- A value shown differently in a table, or a custom card: a **widget**.
- Something that must happen when a record is saved, or be refused: a **hook**.
- A button on a record that does something: an **action**.
- A product with its own tables, roles and screens, installable elsewhere: an **app**.

Hooks and actions run on the server with the project. They are not part of an app's package. If
an app depends on one, the thing to deliver is the project, and you must say so.

## Working rules

- After any change run **check the project**. It needs no database and names the file and field of
  each problem.
- Hooks and actions name the database they are for by its key in `adminium.config.ts`.
- A page file holds no id from an install. Tables and columns are named, never numbered.
- Do not edit `.adminium/`: it is build output.
- Do not put a secret in a file that is committed. Settings that are secret go in `.env`, which
  you do not open.
- `npm run dev` restarts the server when `.env` or the config changes, and swaps code in when a
  hook, action, page or widget changes.

## Deploying

Read `references/projects/deploy--*.md`. The project's `Dockerfile` builds on the official image;
keep its tag equal to the `@adminiumjs/adminium` version in `package.json` (**check the project**
compares them).
