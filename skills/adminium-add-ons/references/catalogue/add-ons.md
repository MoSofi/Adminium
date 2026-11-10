<!-- produced from scripts/release/add-ons-bundle.json; do not edit -->

# Add-ons: the first-party set

The add-ons this version of Adminium bundles in its Docker image and desktop app, with the exact
version of each. A newer one may exist: the live list is on the person's own Adminium, under
Server settings → Add-ons.

| Key | Version | Package | Fingerprint file |
|---|---|---|---|
| `barcode-labels` | 1.0.26 | `https://downloads.adminium.dev/add-ons/barcode-labels/barcode-labels-1.0.26.tgz` | `barcode-labels-1.0.26.tgz.integrity` holding `sha512-Sx5EsKfWwVIbciAG4vjmUSE+0w9Km2PrAwobM5cqtx/ixJcUPNMThournRcAzw0pkM7SS8wI0q6/29bmacJGQA==` |
| `customiser` | 1.0.26 | `https://downloads.adminium.dev/add-ons/customiser/customiser-1.0.26.tgz` | `customiser-1.0.26.tgz.integrity` holding `sha512-f9lVkp6F3xtv48FkfWzHKhMwqqjHmM3pAXlRq7XvuGPW4ryhUXLBifuigNabAG6tLB8tzMF7QaKvzcG4WTm5rg==` |
| `design-studio` | 1.0.26 | `https://downloads.adminium.dev/add-ons/design-studio/design-studio-1.0.26.tgz` | `design-studio-1.0.26.tgz.integrity` holding `sha512-C+m9DDVOPJWo0mKW1G5P+ETcH7W99SOXZSQ/QC+KRh/ODT1sI1WXsToh+uYGQaPZu+fq5pAjpXrXQtWEkGRduA==` |
| `forms` | 1.0.26 | `https://downloads.adminium.dev/add-ons/forms/forms-1.0.26.tgz` | `forms-1.0.26.tgz.integrity` holding `sha512-oQVTiz9V2MilxYqqAifVfqDFXExfVNKz/xyglaF3ifP/80ajqwIDvc4F1wHPpwQ9e04exbhidTpkg1kA0YkbLA==` |
| `holiday-calendars` | 1.0.26 | `https://downloads.adminium.dev/add-ons/holiday-calendars/holiday-calendars-1.0.26.tgz` | `holiday-calendars-1.0.26.tgz.integrity` holding `sha512-zj7PP6JSyFNPCdjGolnhARi0z/SwxvDhwiGU9hD9j5nfsPuNj1cVje8osNrhbd6kUJSns56CLNyNbiGq2s0mpQ==` |
| `import-canva` | 1.0.26 | `https://downloads.adminium.dev/add-ons/import-canva/import-canva-1.0.26.tgz` | `import-canva-1.0.26.tgz.integrity` holding `sha512-r7XM+VR9467bl20xsLhr+/sqREQ5wJ3cwV6I8jWKTfkYO4qRCHj/Nl4+Macu68FiseOH+YqYgKH73cHNgQeUSw==` |
| `inventory` | 1.0.26 | `https://downloads.adminium.dev/add-ons/inventory/inventory-1.0.26.tgz` | `inventory-1.0.26.tgz.integrity` holding `sha512-f0BmYlAvhKSIuOwLfLXVYE3S6NlQ7+MiwP59gcSTbBNfXz4nf2foB5undG8hMZ0/LdHp5WFA/bJlZZELTfxK4g==` |
| `invoices` | 1.0.26 | `https://downloads.adminium.dev/add-ons/invoices/invoices-1.0.26.tgz` | `invoices-1.0.26.tgz.integrity` holding `sha512-Q6ROpu6KsUyxCzbNyCDE3vnFlD4oaUs5bxdRbbNIrwvvRdoNGMRNg1yb9tlS0dkPNP13fHYCWmdF7p7j9kkFYg==` |
| `offers` | 1.0.26 | `https://downloads.adminium.dev/add-ons/offers/offers-1.0.26.tgz` | `offers-1.0.26.tgz.integrity` holding `sha512-eomxpuFCHtx6/0MDdUZdaa3thYytsmrJys+yLsR6lpQmsSkt4H5NIGHRT7PAZnNHxAmaEL/KTPQw1/UPBuTLgg==` |
| `payments-paypal` | 1.0.26 | `https://downloads.adminium.dev/add-ons/payments-paypal/payments-paypal-1.0.26.tgz` | `payments-paypal-1.0.26.tgz.integrity` holding `sha512-HDhrRrGYhhggXvF9JXlPG9EshgbIgF7Gq2XcEEipaVBluKW7CH02vZZ+JAk/wk6KNShbrty0oMEjomigmLuOag==` |
| `payments-stripe` | 1.0.26 | `https://downloads.adminium.dev/add-ons/payments-stripe/payments-stripe-1.0.26.tgz` | `payments-stripe-1.0.26.tgz.integrity` holding `sha512-k5COKAuTT2GRiAjAd6PCCp/jVyVGWOG4XStCtMXO9BSsjHmcpmE83SkqRTym1sZ++yuG1zo+vy8SKCy58J07qg==` |
| `personalizer` | 1.0.26 | `https://downloads.adminium.dev/add-ons/personalizer/personalizer-1.0.26.tgz` | `personalizer-1.0.26.tgz.integrity` holding `sha512-0jDUWJHUN5UWubjjYp0/aa8TlQeBprdfu+oLb096HuW/6az5/Y90iT2HHqLLdhggR7MF97YkoHaQ463tDZXRDw==` |
| `shipping-dhl` | 1.0.26 | `https://downloads.adminium.dev/add-ons/shipping-dhl/shipping-dhl-1.0.26.tgz` | `shipping-dhl-1.0.26.tgz.integrity` holding `sha512-HMolOa0RqkCrQgegOD5PzXgyARDYvRuGU0mDrbTimFJE6lXpWtHX8X2M9VUsFOVejqggI4jXKZiG8cWZnU94fw==` |

The key is what an app writes in `manifest/add-ons.json`. To give `adminium app try` an add-on,
put its `.tgz` and a `.tgz.integrity` file holding the fingerprint above in one folder and pass
`--add-ons <folder>`.
