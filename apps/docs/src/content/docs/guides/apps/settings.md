---
title: An app's settings page
description: Switch an installed app's staff and customer screens on or off, choose where its staff screens live, give it addresses and extra instances, and disable, update or uninstall it.
---

Every installed app has a page of its own. Open **Studio → Hosted apps** and click the app's name
under **Installed apps**. It needs the **Install and manage apps and add-ons** permission; without
it the page is not offered at all.

The header shows the app's name, its version and publisher, and one status: **Active**,
**Disabled**, or **Update available** with the version. **Open the app** opens its staff screens,
in the dashboard or at their own address. **Update** reads **Up to date** until a newer version
exists.

Installing, updating and uninstalling are covered in
[Installing apps](/self-hosting/installing-apps/).

## Sets of screens

An app has up to two sides, each listed under **Sets of screens** with its own switch:

- **Staff screens** — "Your team signs in here with their own accounts." Who may open them is a
  grant; see [App roles and staff access](/guides/apps/roles-and-staff-access/).
- **Customer screens** — "Customers use these pages. They are public." They read your data through
  the app's own key; see [An app's public access](/guides/apps/public-access/).

Switching a side **Off** stops serving it and deletes nothing. A page load of a switched-off side
gets a plain page instead of the app: staff read that the staff screens are switched off and to
ask their manager, guests read that the app is not available right now. Other requests answer
`503` with the code `SURFACE_OFF`. Switching the customer side off also stops the app's own public
key. Switch the side on again and it is back at once.

### Where the staff screens live

With the staff side on, **Where it lives** chooses between:

- **On its own address** — the staff screens open in a tab of their own, at the address below the
  switch. The sidebar shows an **Open the staff screens** link.
- **Inside the dashboard** — the staff screens open inside the dashboard, under the sidebar and top
  bar, and each screen is a row in the app's section of the sidebar.

The app chooses one when it is installed. **Placement** on the **Surfaces** card of
**Studio → Hosted apps** is the same setting.

## Addresses and domains

Each side shows its address, with **Copy**: its domain when one is attached, otherwise
`/apps/<key>/staff/` or `/apps/<key>/customer/` on this server. The staff side also has
**Add a domain**: type a host such as `till.example.com` and **Add**, and that host opens the
staff screens. The customer side has **Preview**, which opens the
customer screens in a new tab.

To give the customer side a domain, use the **Domains** card on **Studio → Hosted apps**: enter
the host, pick the surface, and **Save domains**. A host already mapped to another app is refused,
and so is the host you are using to reach Studio. DNS, the reverse proxy and certificates are set
up as in [An app surface on its own domain](/self-hosting/app-domains/).

### What a customer domain serves

A customer domain is the business's public address, so it serves nothing of the admin panel:

- the app's customer pages, at `/`, with deep links;
- the public API, `/api/v1/public/*`, which those pages call;
- the app's own customer assets under `/apps/<key>/customer/`.

Everything else answers `404`: the sign-in pages, the rest of `/api`, other apps' `/apps/…`
paths. A browser that loads one of those addresses gets a plain **Page not found** page, "There's
nothing at this address. Check the link and try again.", in the visitor's language; a script gets
the JSON error.

A staff domain works differently, because staff have to sign in there. It keeps the dashboard's
sign-in pages; see [what a mapped staff domain does about sign-in](/self-hosting/app-domains/#what-a-mapped-staff-domain-does-about-sign-in).

## Extra instances

One installed app can serve more than one database, for example two branches with a database each.
On **Studio → Hosted apps**, the **Instances** card adds one: pick the **App**, type a **URL
segment**, choose the connection it **Reads**, and **Save instances**.

An instance answers at `/apps/<key>/<segment>/staff/` and `/apps/<key>/<segment>/customer/`, and
reads only the connection you gave it. The segment cannot be `staff` or `customer`. All instances
share the one installed copy of the app, so updating the app updates every instance. The key the
install made reads only the install's own database, so an instance's customer screens need a
browser key of their own, created on the **API keys** page for that connection with the app chosen
under **App**.

A domain can open an instance: pick it under **Instance** on the **Domains** card. An instance
that a domain still opens cannot be removed until you remove that domain.

## The app's own settings

An app can declare settings of its own, such as a business type. Each one is a card on the page,
with the app's label, its choices and a line of help. A change saves at once, and the app's screens
read it the next time they load.

**App names** on **Studio → Hosted apps** renames the app: in its own screens and in the sidebar.
Leave it empty to use the name the app was built with.

## Data, sample data and activity

- **Data** names the connection the app uses and lists its tables with a row estimate from the
  last schema read, not a live count. It is also where
  [the offer to rename old table names](/self-hosting/installing-apps/#tables-made-before-prefixes)
  appears.
- **Sample data** appears for an app that ships some. See [Sample data](/guides/apps/sample-data/).
- **Activity** lists the latest changes to the app and who made them: installed, updated, switched
  off or on, settings, domains, instances, renames and sample data.

## Disable and enable

**Disable**, in the **Danger zone**, switches the whole app off:

- its section is hidden from the sidebar for everyone;
- its screens and its own public key stop answering: a page load gets the plain page described
  under [Sets of screens](#sets-of-screens), anything else `503` with the code `APP_DISABLED`;
- its roles grant nothing while it is off.

The tables, records and settings stay as they are. **Enable** brings back exactly what was there.
An install that stopped part way cannot be switched on or off; it is finished by installing again.

## In the sidebar and the command palette

An installed app has a section of its own in the sidebar, after your workspace pages, headed by its
name and version. It holds the pages the app made, grouped as the app groups them, and its staff
screens: as rows when they live inside the dashboard, or as an **Open the staff screens** link when
they live on their own address. An extra instance on its own address adds an
**Open the staff screens ·** *segment* link.

The command palette has an **Apps** group with the same things. It finds the app's pages and each
of its staff screens by name; a screen that lives on the app's own address opens there, in a new
tab.
