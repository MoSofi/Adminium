<!-- produced from apps/docs/src/content/docs/guides/add-ons/customiser.md § The customer's editor; do not edit -->

# The Customiser add-on: The customer's editor

Adminium serves no add-on code to a shop's visitors. The editor a customer designs in ships in the
Customiser's package, under its `./browser` export, and the shop app bundles it into its own
customer side, at the version its range asks for. The editor reads the shop's published bases,
designs, fonts, palettes and features through the Customiser's public entries, which ride the app's
own customer key, each held to the app's rows by `appColumn`. Saving a design asks for the human
check. See [An add-on's entry on each app's key](https://docs.adminium.dev/reference/manifest/#an-add-ons-entry-on-each-apps-key).
