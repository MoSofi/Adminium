---
'@adminium/server': patch
---

Two things a shop selling gift cards from an app ran into:

- An add-on installed as part of an app's install or update, with the app's public access allowed, now opens its own key too. Before, only installing the add-on by itself did, so the link in a gift card's email could not be opened in a shop that ticked Offers & gift cards while installing its app.
- An account that opens only its app's screens may draw a document of an add-on its app uses (`POST /add-ons/:key/documents/render`) and open the page by its one-time ticket: a cashier prints the gift card they have just sold.
