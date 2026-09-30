---
title: App roles and staff access
description: Who may open an installed app's staff screens, the roles an app brings with it, people who use only the app, and what staff see when they sign in on the app's own address.
---

An app's **staff screens** are for your team: a till, a front desk, a kitchen board. Signing in is
not enough to open them. Opening them is a permission of its own, given through roles like every
other permission.

## Who may open an app's staff screens

Under **People → Roles & permissions**, the **Apps** rows decide it:

- **Open every app's staff screens** covers every installed app, now and later.
- **Open** *app*'s staff screens covers one app.

Super Admin needs neither. The built-in Admin, Editor and Viewer roles hold **Open every app's
staff screens** from the start, so anyone with one of them can open every app. A role you create
starts without it, like every other permission; tick one of the rows to give it.

The permission is checked on every address the staff screens answer on: `/apps/<key>/staff/`, an
extra instance, a domain mapped to them, and inside the dashboard.

## The roles an app brings

An app can declare roles of its own, such as a cashier and a manager. They are created when the app
is installed, named as the app names them, and appear under **People → Roles & permissions** beside
yours. Give them to people as you would any role.

An app's role can only grant things inside that app: reading or changing its own tables, seeing
the personal data in them, viewing or editing its own pages, and opening its own staff screens. It
can never grant a console permission, such as managing users or connections, and never a wildcard.

- **Your changes survive updates.** A role's grants are given once. An update adds only the grants
  a new version asks for, so a grant you took away stays away.
- **Disabled with the app.** While the app is switched off, its roles grant nothing. Nothing about
  them is deleted, and switching the app on again restores them.
- **Removed on uninstall.** Uninstalling the app deletes its roles. Everyone who held one loses it,
  and API keys bound to one of those roles are deleted and stop working at once. The uninstall
  dialog says how many people and keys each role has before you confirm.

## Personal data

Columns that hold personal data, such as a patient's mobile, email, address or an allergy note, are
masked: a person without the right permission reads them as empty. Two permissions show them:

- **See personal data** on a table shows that table's personal columns, and no other table's. An app
  grants it to the roles whose work needs it, such as a clinic's reception, which rings patients.
- **Manage database connections** shows every table's personal columns. Super Admin and the built-in
  Admin role hold it.

The table asked about is always the one the value lives in. A list of appointments that shows each
patient's mobile needs **See personal data** on the patients table, not on the appointments table.
The same holds for record pages, dashboard cards and exports.

Under **People → Roles & permissions**, **See personal data in records** gives a role the
permission on every table. It is never included in anything else, so no existing role gains it. An
app role's grant on a single table is counted in the line above the matrix and kept when you save.

Live updates pushed to open pages are masked for everyone, whatever their roles, because everyone
watching a table receives the same update.

## Edits limited to some columns

An app can limit what a role's edit permission on a table may change. A clinic's clinician may move
a visit along, from roomed to with the clinician to ready, and may not cancel it or change its time.

When a limited person saves a change outside the limit, Adminium refuses it with `403` and the code
`COLUMN_FORBIDDEN`, naming the column, and the value when the column may change but not to that
value. The limit covers:

- editing one record, and a column sent unchanged, as a form that sends the whole record does;
- editing many records at once;
- rows edited from another record's form, such as a patient's visits from the patient.

Roles add up. Someone who also holds a role that may edit the table without a limit, such as a
manager, an Admin or Super Admin, is not limited. A role an app copies from a limited role
(`cloneFrom`) is limited the same way.

The limit applies to edits only. Creating records is its own permission, and an app can limit it the
same way (`creatable`): a kitchen tablet may start an order with its name, pickup time and note, and
never choose its channel, its customer or its link. A new record given a column outside that limit
is refused with the same code and `reason: "create-limit"`, whether it is made on its own, added from
another record's form, or imported. Deleting is its own permission too. Undo
puts back what the same person changed a moment ago, and is not limited. Files attached beside a
record are not columns of it, so the limit does not cover them.

An update of the app replaces the role's limits with the ones the new version declares. Saving the
role under **People → Roles & permissions** keeps them; the screen does not show them. See
[`limits`](/reference/manifest/#roles) in the manifest reference.

## Reads limited to some columns

An app can also limit what a role **reads** of a table. A hotel's housekeeping sees a stay's room,
its dates and its status, so the rooms get turned round in time, and nothing of its guest or its
money. The table's key and its links to other rows are always shown: a screen moves through them.

Every staff read of the table holds to the limit: lists and records, links and lookups, search,
exports and imports, dashboard cards and their live updates, documents, the audit log, files kept
in a hidden column, and the page assistant. Asking for a hidden column by name (to show it, filter
by it or sort by it) is refused `403` `COLUMN_FORBIDDEN` with `details.reason: "read-limit"`. A
refusal of a write never repeats a hidden value, and a figure worked out from hidden columns (a
limit's counts, a stay's nightly lines) is refused rather than shown in part.

A hidden column is not written through the role either, on an edit or a create, unless the role's
edit limit names it. Roles add up here too: someone who also holds a role that reads the table
without a limit reads all of it, two limited roles read what either shows, and Super Admin is never
limited. A card or a live update follows a change to the role at once.

:::caution[Upgrading]
Moving back to a release that does not know read limits drops them: a role limited this way would
read the whole table again. Keep backups of the meta store before an upgrade, and do not roll back
an install whose app roles rely on read limits.
:::

## People who only use the app

An app can mark a role as **screens only**: for someone who works in the app and never in the
dashboard, like a cashier. When **every** role a person holds is a screens-only role, that person
is sent to the app instead of the dashboard:

- opening the dashboard takes them to the app's staff screens, on the app's staff domain when one is
  attached, otherwise at `/apps/<key>/staff/`;
- the dashboard's API refuses them with `403` and the code `APP_SCREENS_ONLY`, except for what the
  app's screens need: signing in and out, their own account, the records their roles grant, live
  updates and translations.

Give that person any ordinary role as well, or make them Super Admin, and the dashboard opens for
them again.

## Someone without access

A person who is signed in but may not open the app's staff screens sees a plain card instead of the
app: "This account can't open *app*." and "Ask your manager for a role that opens *app*.", with the
name and email they are signed in as and **Sign out**. The page answers `403`. A script gets `403`
with the code `FORBIDDEN` and the reason `NO_STAFF_ACCESS`.

**Sign out** ends that session and goes to the sign-in page, which is what someone on a shared
tablet usually wants next.

When the app or its staff side is switched off, everyone gets a similar card saying so, with the
advice to ask their manager to switch it on. See
[An app's settings page](/guides/apps/settings/#sets-of-screens).

## Signing in on the app's own address

On `/apps/<key>/staff/`, someone who is not signed in is sent to the dashboard's sign-in page and
returned to the app afterwards.

On a domain attached to the staff side, the sign-in page belongs to the business instead:

- the header shows the first letter and name of the workspace (or the app's name while the
  workspace still has the default name), and "*app* · Staff sign-in";
- the footer reads "Shared tablet? Everyone signs in with their own account.";
- the form has a **Keep me signed in on this tablet** box;
- after a successful sign-in, including two-factor, the page shows **Opening** *app*… and
  "Signed in as *name*" while the app loads.

Staff sign in once per domain, because a session belongs to the address it was made on. See
[An app surface on its own domain](/self-hosting/app-domains/#what-a-mapped-staff-domain-does-about-sign-in).

:::note[What the tablet box changes]
**Keep me signed in on this tablet** starts ticked. Ticked, the session survives closing the
browser. Unticked, the browser forgets the session when it closes, which suits a tablet that
several people share. The box does the same thing as **Keep me signed in** on the dashboard's own
sign-in page, and it applies to a two-factor sign-in as well.

Either way, the session ends after 7 days without use or at the workspace's session limit, whichever
comes first. A browser that reopens its last tabs may bring back an unticked session too, so on a
shared tablet **Sign out** is still the reliable way to end one.
:::
