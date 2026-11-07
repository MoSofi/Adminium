<!-- produced from apps/docs/src/content/docs/reference/manifest.md § A self-made app — New in 0.3.49; do not edit -->

# Manifest spec: A self-made app — New in 0.3.49

### New in 0.3.49

Every field below needs `minAdminiumVersion` `0.3.49` or later. An older server then answers
"needs Adminium 0.3.49" instead of naming an unknown key.

| Field | Where | Who may use it |
|---|---|---|
| [`provenance`](https://docs.adminium.dev/reference/manifest/#provenance), [`icon`](https://docs.adminium.dev/reference/manifest/#icon) | top level | self-made apps only |
| [`apps.requires`](https://docs.adminium.dev/reference/manifest/#appsrequires) | top level | self-made apps only |
| [`instance`](https://docs.adminium.dev/reference/manifest/#instance) | top level | self-made apps only |
| [`reports`, `invoiceLayouts`, `scheduledReports`](https://docs.adminium.dev/reference/manifest/#reports-invoicelayouts-and-scheduledreports) | top level | self-made apps only |
| [`payments`](https://docs.adminium.dev/reference/manifest/#payments) | top level | self-made apps only |
| [`envelope`, `views`](https://docs.adminium.dev/reference/manifest/#a-pages-envelope-and-its-views) | a page | self-made apps only |
| [`name`, `schema`](https://docs.adminium.dev/reference/manifest/#a-tables-real-name-and-schema) | a table | self-made apps only |
| [A column's own name](https://docs.adminium.dev/reference/manifest/#columns-under-their-own-names) | a column's `ref` | self-made apps only |
| [`path`, `pagination`, `rateLimit`, `response`; `PUT`, `BATCH`, and `DELETE` beyond an add-on's own link](https://docs.adminium.dev/reference/manifest/#public-access) | a public entry | self-made apps only |
| [`exclude`, `existingCustomers`, `switchedOff`](https://docs.adminium.dev/reference/manifest/#tables) | a table | every app |
| [`time`](https://docs.adminium.dev/reference/manifest/#column-types), [`precision`, `hidden`, `yesNo`, `relation`](https://docs.adminium.dev/reference/manifest/#columns) | a column | every app |
| [`description`](https://docs.adminium.dev/reference/manifest/#option-lists) | an option list's answer | every app |
| [`kind`, `category`, `brand`, `attachments`](https://docs.adminium.dev/reference/manifest/#emailtemplates) | an email template | every app |
| [`watch`, `to: { "kind": "fixed" }`, `purpose`, `webhook`, `document.render`](https://docs.adminium.dev/reference/manifest/#automations) | a rule | every app |
| [`options`, `trigger`, `deliver`](https://docs.adminium.dev/reference/manifest/#documents) | a document | every app |
| [`instances`](https://docs.adminium.dev/reference/manifest/#frontends) | a frontend | every app |
| [`scope`](https://docs.adminium.dev/reference/manifest/#add-on-manifests) | the `addOn` block | add-ons |
