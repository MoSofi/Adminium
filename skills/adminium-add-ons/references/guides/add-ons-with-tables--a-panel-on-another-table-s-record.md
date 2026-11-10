<!-- produced from apps/docs/src/content/docs/guides/add-ons-with-tables.md § A panel on another table's record; do not edit -->

# Add-ons that keep tables of their own: A panel on another table's record

A page of the add-on's own code may also be drawn on another table's record page:
[`addOn.panels`](https://docs.adminium.dev/reference/manifest/#a-panel-on-another-tables-record) names the file, the
add-on's table that the record links into, and the tab's title. The panel is handed the record and
the key of the row it links to, and runs with the data kit of the add-on's own tables. It is
shown only to a reader who reads the record, holds a grant on that table of the add-on's, and
holds the panel's permission, which the add-on's roles grant as `page:@<id>:view`.
