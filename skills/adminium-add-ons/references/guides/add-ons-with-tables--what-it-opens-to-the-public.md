<!-- produced from apps/docs/src/content/docs/guides/add-ons-with-tables.md § What it opens to the public; do not edit -->

# Add-ons that keep tables of their own: What it opens to the public

An add-on may ask for two kinds of public access. Neither is opened by installing it.

1. **Entries served through an app's public key.** A gift-card add-on may let a customer read a
   card's balance by typing its code on the shop's own page. Such an entry is put on the public key
   of an app that names the add-on, and only when you tick **Allow public access** — and only if
   you may manage API keys. Left unticked, the add-on is installed and its entries wait.
2. **One link key of its own.** Whoever holds a row's link opens that one row and can only read
   it. It is made with the same tick.

The entries leave an app's key the moment the add-on stops being there for that app: when you
switch it off for the app, uninstall it, or update it to a version that drops the entry. Switching
it back on does not put them back by itself; Studio asks.

See [An app's public access](https://docs.adminium.dev/guides/apps/public-access/#what-an-add-on-adds) for how this looks
from the app's side.
