<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Capabilities; do not edit -->

# Manifest spec: Capabilities

`capabilities` (and `compatibility.requires`) take values from one closed list:

| Value | Meaning |
|---|---|
| `hosted-only` | Only runs on a hosted Adminium. Cannot be combined with `offline-required`. |
| `offline-required` | Must keep working with no network. Cannot be combined with `hosted-only`. |
| `receipt-printer` | Prints receipts. |
| `barcode-scanner` | Reads barcodes. |
| `payments` | Takes payments. |
| `file-storage` | Stores files. |
| `email-delivery` | Sends email. |
| `realtime` | Uses live updates. |
| `outbound-http` | An add-on's server code calls a third-party API. Needs `addOn.network.allow`. |
| `oauth-connect` | Adminium runs an OAuth 2.0 flow for an add-on. Needed by `addOn.connect.kind: "oauth2"`. |

The storefront shows an app's capabilities on its card.
