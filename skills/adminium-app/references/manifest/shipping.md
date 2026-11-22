<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Shipping; do not edit -->

# Manifest spec: Shipping

`shipping` says where an app's orders keep what a delivery company needs. It needs Adminium 0.3.71
or later. An app without it can never reach a real carrier: the engine refuses the call with
`APP_NOT_UPDATED`, whatever the client sends.

```json
"shipping": {
  "orders": [{
    "table": "orders",
    "reference": "number",
    "address": {
      "name": "ship_name",
      "lines": ["ship_line1", "ship_line2"],
      "city": "ship_city",
      "region": "ship_region",
      "postcode": "ship_postcode",
      "country": "ship_country",
      "phone": "ship_phone",
      "email": "ship_email",
      "company": "ship_company"
    }
  }]
}
```

| Field | Required | What it is |
|---|---|---|
| `table` | yes | A table of this app. Each table is named once. |
| `reference` | yes | The column shoppers and staff know the order by. Text, a whole number or a UUID. |
| `address.name`, `.city`, `.postcode`, `.country` | yes | Text or enum columns. |
| `address.lines` | yes | One to three text or enum columns, in order. |
| `address.region`, `.phone`, `.email`, `.company` | no | Text or enum columns. |

The server reads the address from these columns, so a request can name an order but never where
its parcel goes. The country must hold a two-letter ISO code; Adminium never guesses one.
