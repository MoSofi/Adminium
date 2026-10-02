<!-- produced from apps/docs/src/content/docs/guides/building-on-an-add-on.md § 1. Require the add-on; do not edit -->

# Building on an add-on: 1. Require the add-on

The shape belongs to the add-on, so the app requires it:

```json
"compatibility": { "minAdminiumVersion": "0.3.1" },
"addOns": {
  "requires": [{ "key": "invoices", "range": ">=1.0.3",
                 "reason": { "en-US": "Invoices, quotes and receipts are made by this add-on.",
                             "de-DE": "Rechnungen, Angebote und Quittungen macht dieses Add-on." } }]
}
```

Installing the app then installs or connects the add-on first, before the app's own tables, and
the add-on cannot be removed, switched off, or updated outside your `range` while the app is
installed. Uninstalling the app keeps the add-on. The `range` is the add-on versions your
tables were built against. Raise `minAdminiumVersion` to the release that reads the fields on this
page: an older server then asks the operator to upgrade instead of calling the manifest invalid.
See [Add-ons](https://docs.adminium.dev/reference/manifest/#add-ons).
