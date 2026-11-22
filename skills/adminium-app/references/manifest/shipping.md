<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Shipping; do not edit -->

# Manifest spec: Shipping

`shipping` says where an app's orders keep what a delivery company needs. It needs Adminium 0.3.72
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
| `tracking` | no | A text column. A bought label's tracking number is written here, for the first outbound parcel, and only while it is empty. |
| `carrier` | no | A text column, for the company moving that parcel. |

The server reads the address from these columns, so a request can name an order but never where
its parcel goes. The country must hold a two-letter ISO code; Adminium never guesses one.

Buying a label never moves the order's status. A label bought with a test key reaches neither column.

An app's role can be given three rights on this install's labels. They need the `shipping` block
and Adminium 0.3.72 or later, and an update that adds one asks first.

| Grant | What it allows |
|---|---|
| `shipping:@:book` | Get a carrier's services for an order and buy its label, within the owner's limits |
| `shipping:@:cancel` | Ask for a label to be refunded |
| `shipping:@:customs` | Declare customs for a parcel |

Someone who holds `shipping:@:book` without managing shipping books only inside the two limits the
owner sets: the most one label may cost, and how many labels all such people may buy on the shop's
day. With no limit set, the owner books. If their read of the order table leaves its money out,
they see each service with no price, no currency and in no price order.
