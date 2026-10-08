<!-- produced from apps/docs/src/content/docs/guides/building-on-an-add-on.md § Get the add-on's manifest; do not edit -->

# Building on an add-on: Get the add-on's manifest

Every name an app builds on (a shape's parts and columns, a ledger's actions and inputs) is in
the add-on's own manifest: `manifest.json` inside the add-on's package. With the package file at
hand:

```bash
tar -xzOf <folder>/invoices-<version>.tgz package/manifest.json > invoices.manifest.json
```

A package is downloaded from the add-on's page on adminium.dev, or from
`https://downloads.adminium.dev/add-ons/<key>/<key>-<version>.tgz`, with its `sha512-` fingerprint
saved beside it as `<key>-<version>.tgz.integrity`. Keep the two files in one folder: that folder
is what `adminium app try --add-ons <folder>` reads.
