<!-- produced from apps/docs/src/content/docs/guides/apps/public-access.md; do not edit -->

# An app's public access

An app's **customer screens** are public pages: a booking form, a menu, a guest's own reservation.
They have no signed-in user, so they read and write your database through the
[public API](https://docs.adminium.dev/guides/public-api/endpoints-and-keys/), with a browser key the install makes for them.
This page covers the app's keys and their endpoints. Everything else about the public API applies
to them unchanged.
