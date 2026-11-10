<!-- produced from apps/docs/src/content/docs/guides/add-ons-with-tables.md; do not edit -->

# Add-ons that keep tables of their own

Most add-ons draw something for an app: an invoice, a shipping label. Some keep data of their own:
a stock list, gift cards. From Adminium 0.3.18 such an add-on declares its tables, pages and roles
in its manifest, in the same words an app uses, and Adminium installs them the way it installs an
app. This page says what that means for you as the owner of the server. The fields themselves are
in the [manifest reference](https://docs.adminium.dev/reference/manifest/#add-on-manifests).
