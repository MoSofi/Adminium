---
title: Build an app in the desktop app
description: Describe an app and the Designer builds it on your computer — projects, versions, model keys, sharing on your network, exporting, and opening a project someone sent you.
---

The desktop app opens on a first screen with four choices. **Build an app** is
[Adminium Designer](/projects/designer/) on your own computer: you describe an
app, a model you bring writes it, and Adminium checks it, applies it and shows
it. Nothing is installed besides the app itself: it carries its own Node and its
own npm.

**Use my own database** is the desktop app as it was before: screens for a
database you already have. See [First run](/desktop/first-run/).

## A project is a folder

"Build an app" asks for a name and makes a folder for it, by default under
`~/Adminium`. Everything about the project lives in that folder: its apps, its
data and its key. You can copy it, back it up, or open it in a terminal with
`adminium design`.

The app refuses a few places and says why: your home folder itself, a folder
that belongs to the system, a folder inside another project. It warns before it
uses a folder that a sync service watches (iCloud Drive, OneDrive, Dropbox,
Google Drive): a live database does badly there.

Making a project downloads the packages it is built with. That needs the
internet once and takes from a few seconds to a few minutes. If it fails, the
app says which of four things happened: no connection, a proxy that refused, the
registry answering with an error, or a full disk.

Projects you opened are listed on the first screen under **Recent projects**.
A row opens the project in the Designer; **Open dashboard** opens the project's
own dashboard instead.

## A model, once per computer

The Designer writes your app with an AI model, and you bring the model: a key
from a provider, or a model that runs on your computer with
[Ollama](https://ollama.com). **Add a model** on the Designer's first page tests
what you enter before it keeps it.

In the desktop app a model is kept **by the app, not by the project**: once for
every project on this computer, encrypted by the system's key store (Keychain on
macOS, Windows' own on Windows, your desktop's key store on Linux). It is never
written into a project's `.env`, so a project you export or share carries no
key. On a Linux desktop with no key store the key is kept as plain text in a
file only you can read, and the screen says so.

If a project's `.env` names a model (it was made on a terminal, or by an older
version of the app), the app does not use that line and says so. A terminal
still reads it.

## Versions

After every change the Designer keeps a version, so you can go back. It uses
git for that. If your computer has none, the Designer's first page offers to
**download git** (about 62 MB, from its publisher, checked against a fixed hash)
or to wait. On a Mac it also names Apple's own developer tools. Nothing is
downloaded until you say so, and versions come on without restarting anything.
What you built before is kept as the first version.

## Open a folder

**Open a folder** is for a project that is already there: one you made earlier,
or one someone sent you.

Opening a project runs its code on your computer, with your access to your
files. So the first time you open a folder the app asks, and shows the folder's
path. It asks again if the folder's code changed while the app was not holding
it — for example when a ZIP was unpacked over it. **Nothing of the folder is
run before you answer.**

After that the app reads the folder and may show you one of these, once:

| What the folder holds | What the app does |
|---|---|
| The project, its data and its key | Says it found them, and opens it. |
| The project and no data | Makes an empty database (and a key, if there is none) and says so. The apps' own tables are made again; rows that were in the old data are not there. |
| Data, but no key | Stops and asks. You can pick the `.env` file you still have, start the data fresh (the old data is moved to a folder named `data.before-<date>`, never deleted), or go on with a new key (saved connections and API keys in the data stop working). |
| No packages, or packages from another kind of computer | Offers to get them. |
| Accounts made on another computer | Lists how many people, API keys and public keys came with it. |
| A project made with an older Adminium | Offers **Update this project**. If you decline, it still opens. |
| Data last changed by a newer Adminium | Does not start it, and offers to update the app. |
| A project a terminal is running | Says on which port, and waits for you to stop it there. |

An app's own build commands are approved **per computer**. A list of approved
commands that arrives inside a folder is not believed.

## Build or share

A project is either **built** or **shared**, never both at once.

While it is built, it answers on your computer only, and the Designer is on.

**Share** puts it on your network so a phone or a colleague's computer can use
it, with the Designer off. Before the first share the app asks you for an email
address and a password: on your own computer you never needed them, but another
device has nothing else to sign in with. A project is never shared without an
owner password.

That password is for other devices. On your own computer the app goes on
signing you in as the project's owner, while you build and when you open the
dashboard of a shared project. This holds for a project made in the app or with
`adminium design`; a project whose first account was made on the setup page
asks for that account's password here too.

While it is shared the app shows the addresses to open on another device (the
one marked **Best** uses your computer's name and survives a change of network
number), a QR code for a phone's camera, and keeps your computer awake. The port
is kept per project, so a bookmark keeps working the next time you share.

A shared project answers only to the addresses the app shows: your computer's
`.local` name, its addresses on the networks it is on, and `localhost` and
`127.0.0.1` on the computer itself, each on the project's port. A request that
asks for it by any other name is refused, so a web page elsewhere cannot reach
your project by pointing a name of its own at your computer.

Sharing is plain `http`: traffic on your network is not encrypted. Share only on
a network you trust. **Go back to building** ends it; people using the project
on other devices are disconnected.

## Export

**Export this project…** (in the menu under the project's name) makes one ZIP.
You choose what it holds:

- **The project's apps, its data and its key.** Whoever opens it can read all of
  it, saved database connections included.
- **The apps only.** No data, no key, none of your chats with the Designer.
  Whoever opens it starts with empty data.

Neither holds your model keys, the downloaded packages, or backups. The project
stops for a moment while the file is made.

To open an export on another computer: unpack it, then **Open a folder**.

## Connect to another Adminium

**Connect to another Adminium** opens an Adminium that runs somewhere else — a
colleague's shared project, or a server — in a window of its own. Type its
address; the app checks that an Adminium answers there first.

An address on your own network may be plain `http`, and the app says it is not
encrypted before it connects. Anywhere else it must be `https`.
