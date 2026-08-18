---
title: First run
description: The four-step desktop setup — where your data lives, what Adminium builds from, your account, and generation.
---

The first time you open Adminium it runs a four-step wizard instead of the app.
Nothing has been created yet at this point: the whole wizard is a set of answers,
and the last step is what executes them.

## 1 · Where your data lives

Pick the directory Adminium will keep everything in — the meta store, any local
SQLite databases it creates, and automatic backups. The default sits next to the
app's own config (`~/Library/Application Support/Adminium/data` on macOS,
`%APPDATA%\Adminium\data` on Windows, `~/.config/Adminium/data` on Linux).

You can put it anywhere you have write access, with one caveat the wizard will
raise as a **blocking warning**:

:::caution[Cloud-synced folders]
Dropbox, iCloud Drive, OneDrive and Google Drive sync files by copying them out
from under whatever has them open. SQLite does not survive that: a synced data
directory corrupts eventually, not immediately, which is the worst way for it to
happen. If you choose one, Adminium makes you confirm it explicitly.
:::

Changing this directory **relaunches the app**, because the background server
process is started with the directory frozen into its environment. That is why
the wizard commits the choice on Continue rather than the moment you pick.

## 2 · What Adminium builds from

Four sources:

| | |
|---|---|
| **Create a new local database** | A SQLite file inside your data directory. Start blank, or from a schema file (SQL, Prisma, Drizzle, Rails, Django, the [JSON IR](/guides/schema-import/), …), optionally with placeholder rows so there is something to look at |
| **Open an existing SQLite file** | Point at a `.sqlite` you already have |
| **Connect to a server database** | PostgreSQL or MySQL, by connection string |
| **Explore the demo database** | A seeded database that ships with the app, for looking around |

Nothing is created yet — this step records a choice. It has to: every endpoint
that could create a database is behind `system:connections:manage`, and on a
fresh install there is no account to hold that permission. Which is the next
step.

## 3 · Your account

Name, email, password. This creates the super admin.

**"Skip login on this computer" is checked by default.** With it on, opening the
app puts you straight into the dashboard — the app is a desktop app on your
machine, and a password prompt every launch buys nothing when anyone who can
read the disk can read the data directory anyway. Turning it off gives you the
normal login screen; you can change your mind later in **Settings → Desktop →
Require login on this device**.

Turn it off if the machine is shared, or if you are going to
[share the app on your network](/desktop/lan-share/) — a LAN-reachable instance
with login skipped is an open door.

You also pick your language and theme here.

## 4 · Generate

Now everything happens, in order: the database is created or connected,
introspected, and an admin panel is generated from what was found — tables,
columns, keys, relations, and the semantics Adminium infers from them.

Optionally, an LLM pass enriches the result with better labels, descriptions and
groupings. It is off unless you turn it on, needs a provider key, and shows you
a diff you have to accept before anything changes. See
[LLM assist](/guides/llm-assist/).

## After the wizard

`config.json` now exists, so the wizard never runs again. If it is ever deleted,
Adminium does **not** start over: an unreadable or missing config next to an
existing data directory is a crash screen with the file path, not a fresh
install. Re-running the wizard would mint a new `ADMINIUM_SECRET` and orphan
every encrypted connection string in the meta store — silently losing your data
is worse than refusing to start.

## Next

- [Backups](/desktop/backups/)
- [Share it on your network](/desktop/lan-share/)
