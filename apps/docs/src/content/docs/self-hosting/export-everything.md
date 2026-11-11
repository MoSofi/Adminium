---
title: Export everything from Studio
description: Download one file with everything made in an installation, then move it to another server with adminium import-zip.
sidebar:
  order: 11
---

**Studio → Server settings → Export everything** downloads one file with
everything made in this installation. Only a Super Admin sees it.

## What the file holds

| In the file | Left out |
|---|---|
| Pages, tables' settings, roles, views, apps' settings | People's passwords |
| People's accounts (names, addresses, roles) | Secrets and keys: connection strings, mail and AI keys, API keys |
| Uploaded files kept on this server | Sessions, password-reset and invitation links |
| Local SQLite databases you connected | The rows of databases on other hosts (see below) |
| The project folder: apps, sides and sites the Designer built | Catalog apps and add-ons themselves (their names and versions travel; download them again) |

It is the same file as `adminium archive create --export`. See
[Back up and move an instance](/self-hosting/archive/) for the whole-instance
backup, which keeps passwords and secrets.

## Download it

1. Press **Download everything**. The server makes the file and the page shows
   how far it has got.
2. When it says **Ready**, press **Download**.

The file can be downloaded once, by the person who asked for it, in the same
browser, within 10 minutes. Then the server deletes it. One export is made at a
time on an installation.

On the desktop app, use **Export this project…** in the Designer's project menu
instead.

## Move it to another server

Install Adminium on the new server, then import the file **before the first
start**, into an empty data directory (and an empty database, if the meta store
is Postgres or MySQL):

```bash
adminium import-zip ./my-installation-2026-11-10.zip --project-dir /srv/my-project
adminium start
```

The file carries no passwords, so the import gives one Super Admin a new one.
It asks which Super Admin (if there are several) and the password, twice. On a
server without a terminal, name the person and pass the password on standard
input:

```bash
printf '%s\n' "$NEW_PASSWORD" | adminium import-zip ./export.zip --owner you@example.com --password-stdin
```

Sign in with that address and password. Everyone else signs in through
**Forgot password**, once mail is set up. Then, in Studio:

- enter connection strings, mail settings and AI keys again;
- download catalog apps and add-ons again from **Studio → Add-ons**.

## Database rows

A local SQLite database travels in the file. The rows of a database on another
host do not. Dump that database with its own tools and load it where the new
server can reach it:

```bash
pg_dump --format=custom --file=shop.dump "$OLD_DATABASE_URL"
pg_restore --dbname="$NEW_DATABASE_URL" shop.dump
```

For MySQL, `mysqldump` and `mysql` do the same.

## Put this online

**Put this online** on the same page (and in the user menu) opens
[adminium.dev/deploy](https://adminium.dev/deploy) in your browser: ways to run
this installation at its own public address. An operator can hide it with
[`ADMINIUM_DEPLOY_LINK=off`](/self-hosting/env-vars/).
