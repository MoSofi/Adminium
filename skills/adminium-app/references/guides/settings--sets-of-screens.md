<!-- produced from apps/docs/src/content/docs/guides/apps/settings.md § Sets of screens; do not edit -->

# An app's settings page: Sets of screens

An app has up to two sides, each listed under **Sets of screens** with its own switch:

- **Staff screens** — "Your team signs in here with their own accounts." Who may open them is a
  grant; see [App roles and staff access](https://docs.adminium.dev/guides/apps/roles-and-staff-access/).
- **Customer screens** — "Customers use these pages. They are public." They read your data through
  the app's own key; see [An app's public access](https://docs.adminium.dev/guides/apps/public-access/).

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
