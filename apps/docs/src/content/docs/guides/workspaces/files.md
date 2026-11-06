---
title: Workspace files
description: Save every database of a workspace as one file of apps, upload it to another server, choose where each app goes, and finish an install that stopped with Install the rest. Plus the adminium workspace commands.
---

One app describes one database ([Save as app](/guides/your-own-apps/save-as-app/)). A
[workspace](/guides/workspaces/) of several databases saves as one **workspace file**: one app per
database, inside a single download. Another server installs it in one review, each app onto its own
database, and can put those databases in a workspace of the same name.

A workspace file is named `<workspace>.workspace.tgz` (for example `fernhill-coffee.workspace.tgz`).
It holds:

- `workspace.json`: the workspace's name, where and when it was saved, the oldest Adminium that can
  install it, and each app's key, version, fingerprint and the name and engine of the database it
  came from;
- one ordinary app file per database, `apps/<key>-<version>.tgz`, exactly as Save as app makes it.

It carries at most **eight apps** and **128 MB**. It does not carry the workspace's sender or its
place in the order, and no people, secrets or history, as for any app file.

## Saving a workspace

**Save workspace** is on the workspace's row of the Workspaces card, on **Studio → Data
connections**. It needs **Install and manage apps and add-ons**, and is offered on a workspace that
has databases.

The dialog, "Save Fernhill Coffee as one file", lists each database of the workspace:

- an **Include fernhill** tick, to leave a database out;
- the app's **Name**, **Key** and **Version**, with "Last saved 1.0.0" when that database was saved
  before. The key starts as the last key it was saved under, or one made from its name. The version
  is the next one;
- **More choices**, which opens the full Save as app wizard for that one database: rows, what to
  leave out, its answers.

Under the list, Check merges every app's items into one list, "App · message". **Save** stays off
while anything needs a choice: "Use More choices on an app to make its choices." The names of the
source workspaces travel in each app, and Check lists them under "for your information".

**Server settings** (only for people who manage server settings): the look, languages, wording and
system emails travel with **one app at most**. Choose **None** (the default) or **From fernhill**.

A file that would be larger than 128 MB is refused before anything is saved: "Leave out a database
or its sample rows and try again." No app's version is used up by a refused save: the apps are
recorded only once the whole file is made.

### The saved file

"Fernhill Coffee is saved as one file" shows the file with its size and **fingerprint** (the
fingerprint of the whole `.workspace.tgz`), then **Apps inside**: each `key-version.tgz` with its
own fingerprint. **Copy** on each. Keep the file's fingerprint with the file: the new server asks for
it.

Each app inside is a save of its own, with its own record and version. Under **Saved from here**
on Hosted apps, **Workspace files saved here** lists each workspace file with **Copy fingerprint**,
**Download again** (packed again from the kept apps, byte for byte the same file) and **Save a newer
version**.

## Installing a workspace file

On **Studio → Hosted apps**, choose **Install an app** and upload the file. A file named
`*.workspace.tgz` opens **Install a workspace file**. Any other name that turns out to be a workspace
file is handed over to it too.

The review, **Check before you install**, has three parts.

### The file

The workspace's name, a **Workspace file** badge, how many apps, and "Made at *label* on *date* ·
Adminium *version*", with the same warning as an app file saved elsewhere. **Check against the
fingerprint shown when it was saved** compares the whole file's fingerprint in your browser. A
mismatch turns Install off.

Before anything is shown, the upload checks the whole file. It is refused as a whole, and nothing is
staged, when:

- an app inside is not the file that was saved (its fingerprint differs from the list);
- an app inside is not the app the list says (another key or version);
- the file holds something its list does not name, or misses an app the list names;
- it holds a workspace file inside a workspace file;
- two apps inside carry the server settings;
- it needs a newer Adminium.

An older Adminium that does not know workspace files refuses one with "needs Adminium 0.3.49" too,
rather than a puzzling error.

### The workspace

Only someone who manages database connections chooses where the databases go:

- **Create workspace Fernhill Coffee**: the default. The databases the apps go into are put in it.
- **Add to Fernhill Coffee**: chosen instead when a workspace of that name already exists.
- **Add to an existing workspace**: pick one.
- **No workspace**: the databases stay where they are in the menu.

When the server has no workspace yet, choosing to create one shows the first-workspace notice:
everyone's menu groups by workspace from then on. Anyone else installs with **No workspace**.

Every database chosen in an **Install on** joins the workspace, even when its app is refused or
stops.

### The apps

One row per app, in the file's order (an app another app needs comes first): its name, version, an
**Install on** select and a status.

- **Install on** lists the databases this server already has. Connect them first: the review never
  adds one. It starts at a database with the same name and engine as the one the app came from,
  when there is one.
- **Show the review** unfolds that app's own review, the same one a single app file gets: tables
  already here, page clashes, rules that send data out (they arrive off and empty), the look and
  languages, screens and after-install items. A row that needs an answer opens itself.

| Status | Meaning |
|---|---|
| **Ready** | It installs when you press Install |
| **Needs a choice** | Its review asks something, or it has no database yet |
| **Update · 1.1.0 → 1.2.0** | The file is newer than the copies here: **every copy** of that app is updated, one at a time, then it is installed on its target if that has none |
| **Installed · 1.2.0** | That version is already on its target. It counts as done |
| **Refused** | It cannot be installed (for example an older version, or another app with this key). The reason is under the row. The others still install |

The button counts what will happen: "Install 2 apps", "Update 1 app", "Install 1 app, update 1".

## Install the rest

The install runs one app after another. An app that is refused is skipped and recorded on its row.
An app that **stops** part way ends the run there: the apps before it stay installed, and that app
keeps nothing.

"2 of 3 installed. kiln-shop stopped. Nothing of it was kept." **Install the rest** runs again,
skipping every app already installed, updated or refused, and never creating the workspace twice.

The uploaded file stays on the server until it is installed or discarded, so this survives closing
the tab. **Workspace files waiting**, on Hosted apps, lists each file uploaded and not finished,
with **Install the rest** (or **Review and install**) and **Discard**. Discard removes the uploaded
apps nothing installed. **Cancel** on the review discards too; **Back** keeps the file waiting.

Only one install of a file runs at a time.

## Done

"3 of 3 apps are installed. They are on *server*, in the new workspace Fernhill Coffee." **What
happened** lists each app: installed or updated on its database, or not installed and why. Each
app's page has its own [After you install](/guides/your-own-apps/install/#the-apps-page) list.

## From the command line

```bash
npx @adminiumjs/adminium workspace list
npx @adminiumjs/adminium workspace save --workspace "Fernhill Coffee" --out fernhill.workspace.tgz
```

[`adminium workspace list`](/reference/cli/#workspace-list) prints each workspace, its id and its
databases. [`adminium workspace save`](/reference/cli/#workspace-save) makes the same file as **Save
workspace**, with host access; its answers go in an `--answers` file, and `--plan` prints each app's
Check and writes nothing. A file saved from the command line keeps no copy in the Files library, so
**Download again** cannot serve it.

A workspace file is installed from the dashboard only.
