<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests — An add-on that works with another; do not edit -->

# Manifest spec: Add-on manifests — An add-on that works with another

### An add-on that works with another

An add-on never requires another, and may name up to 8 in `addOns.suggests`. Naming one lets it
ship a [document](https://docs.adminium.dev/reference/manifest/#documents) the other draws and list the other's rows by a
[pair](https://docs.adminium.dev/reference/manifest/#a-list-of-an-add-ons-rows). Each works only while
both are installed: a document whose add-on is absent is not made, and is made the moment that
add-on is installed, and an email that would carry it goes without it.
