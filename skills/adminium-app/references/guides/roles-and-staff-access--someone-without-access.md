<!-- produced from apps/docs/src/content/docs/guides/apps/roles-and-staff-access.md § Someone without access; do not edit -->

# App roles and staff access: Someone without access

A person who is signed in but may not open the app's staff screens sees a plain card instead of the
app: "This account can't open *app*." and "Ask your manager for a role that opens *app*.", with the
name and email they are signed in as and **Sign out**. The page answers `403`. A script gets `403`
with the code `FORBIDDEN` and the reason `NO_STAFF_ACCESS`.

**Sign out** ends that session and goes to the sign-in page, which is what someone on a shared
tablet usually wants next.

When the app or its staff side is switched off, everyone gets a similar card saying so, with the
advice to ask their manager to switch it on. See
[An app's settings page](https://docs.adminium.dev/guides/apps/settings/#sets-of-screens).
