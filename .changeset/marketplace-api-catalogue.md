---
'@adminium/manifest': patch
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
'@adminium/docs': patch
---

The online add-on and app catalogues read adminium.dev's marketplace API (`/api/v1/marketplace/add-ons` and `/apps`) instead of the static feeds the site published at each build, so a new release is offered as soon as the site has checked it. The request names this server's Adminium version and the site answers with the newest release of each item that version can install: an older server is offered an older release it can use, where it used to be told only that the newest needed an upgrade. An item whose every release needs a newer Adminium is still listed, with the version it needs. An item the site lists as coming soon shows a Coming soon badge and "Not available yet" in place of its button, and a download of one is refused with `NOT_RELEASED`. Cards show the catalogue's own icon (an app's drawing, an add-on's monogram), who publishes it, when it last changed, and which add-ons an app needs. A price in a release is refused, and one anywhere else is dropped, so none reaches a card. An item the server cannot read is skipped and named in the refresh's audit row, and the rest are still offered. A catalogue cached by 0.3.5 or earlier reads as none until the next refresh. `@adminium/manifest` exports the API's wire schema.
