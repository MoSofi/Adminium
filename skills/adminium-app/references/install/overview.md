<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md; do not edit -->

# Installing apps

An **app** is a whole product Adminium hosts for you — an appointment desk, a client portal, a
box office — served at `/apps/<key>/<side>/` and backed by tables in *your* database. Apps are
installed and managed from **Studio → Hosted apps**.

Whatever an app's source, the way in is the same: its sha512 hash is verified against a pinned
value, the archive is unpacked under hardened limits, its manifest is validated, and **every table
it needs is checked and shown to you before a single one is created**. Nothing is served until you
press **Install**.

This page covers where app packages come from and what each source sends over the network, then
installing, updating and uninstalling. Running an installed app — its switches, addresses, sample
data, roles and public access — is covered under [An app's settings page](https://docs.adminium.dev/guides/apps/settings/).
Add-ons, which extend a deployment rather than being one, have
[their own page](https://docs.adminium.dev/self-hosting/installing-add-ons/) and their own switch.

Installing, updating and uninstalling an app all need the **Install and manage apps and add-ons**
permission.
