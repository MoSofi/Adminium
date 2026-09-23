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

An app's role can only grant things inside that app: reading or changing its own tables, viewing or
editing its own pages, and opening its own staff screens. It can never grant a console permission,
such as managing users or connections, and never a wildcard.

- **Your changes survive updates.** A role's grants are given once. An update adds only the grants
  a new version asks for, so a grant you took away stays away.
- **Disabled with the app.** While the app is switched off, its roles grant nothing. Nothing about
  them is deleted, and switching the app on again restores them.
- **Removed on uninstall.** Uninstalling the app deletes its roles. Everyone who held one loses it,
  and API keys bound to one of those roles are deleted and stop working at once. The uninstall
  dialog says how many people and keys each role has before you confirm.

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
