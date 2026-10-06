<!-- produced from apps/docs/src/content/docs/guides/apps/public-access.md § What an add-on adds; do not edit -->

# An app's public access: What an add-on adds

An app may name add-ons (`addOns.requires`, `addOns.suggests`). An add-on that keeps tables of its
own may ask for public entries too: a gift-card add-on lets a customer read a card's balance by
typing its code. Those entries are the add-on's, and they are served through **your app's own
customer key** — so the app's page asks for them like any of its own.

- The app's install check lists them beside the app's own entries, each with the add-on it comes
  from, when the install would bring that add-on.
- An add-on installed or connected later puts nothing on the key by itself. Studio shows **Allow
  public access**; ticking it needs the permission to manage API keys.
- They leave the key when the add-on is switched off for the app, removed, or updated to a version
  that drops them, and when the app is updated to a version that no longer names the add-on.
- Held to the same rules as the app's own entries: what an app's key can never do, an add-on's
  entry on it cannot do either.

The add-on's real table names reach the app's screens in the config: `addOns.<key>.tables` on the
staff side (`{ "cards": "cards_kit_cards" }`), so a screen never builds a prefixed name itself. An
add-on's own link key, when it has one, is in the customer config under `addOns.<key>.keys`.
