<!-- produced from scripts/release/add-ons-bundle.json; do not edit -->

# Add-ons: the first-party set

The add-ons this version of Adminium bundles in its Docker image and desktop app, with the exact
version of each. A newer one may exist: the live list is on the person's own Adminium, under
Workspace settings → Add-ons.

| Key | Version | Package | Fingerprint file |
|---|---|---|---|
| `barcode-labels` | 1.0.14 | `https://downloads.adminium.dev/add-ons/barcode-labels/barcode-labels-1.0.14.tgz` | `barcode-labels-1.0.14.tgz.integrity` holding `sha512-AekDg4d4aBSbUE9TR1eQSaMUuqHyWsP45ZgWClSqanwFhcvBhDizqvk7SaeB0KqUtJA10E3TcZCKo8p/D2nbuA==` |
| `design-studio` | 1.0.14 | `https://downloads.adminium.dev/add-ons/design-studio/design-studio-1.0.14.tgz` | `design-studio-1.0.14.tgz.integrity` holding `sha512-p2pb3OItVvIghUFKKoo4LbC3WfrRl9MveHf0orVf1QNCLs+Fn9g2A59rkYYs01V8ko4mW/B+bENU/veYHpNyUQ==` |
| `holiday-calendars` | 1.0.14 | `https://downloads.adminium.dev/add-ons/holiday-calendars/holiday-calendars-1.0.14.tgz` | `holiday-calendars-1.0.14.tgz.integrity` holding `sha512-l7eGXSGxo+LxobDsxYfYuzNmCweHTj7yafufgbdG5UsxNieqyWo+Gq2jn3cfTU12P8BDKDGunjbQhBJ03Iq/sw==` |
| `import-canva` | 1.0.14 | `https://downloads.adminium.dev/add-ons/import-canva/import-canva-1.0.14.tgz` | `import-canva-1.0.14.tgz.integrity` holding `sha512-Mn2EtTfS+GUppKXm2xtg+GYDNvXiaNDsqYrA/nsRN5SnFLxjL+c4FrqcsbsyTN4xoFr/WU1IH/VqfgDynxNgQA==` |
| `inventory` | 1.0.14 | `https://downloads.adminium.dev/add-ons/inventory/inventory-1.0.14.tgz` | `inventory-1.0.14.tgz.integrity` holding `sha512-7Rx6j8Va/WDz3Q8Bj88x5rdsOZd1XzNR1qqDF5Dr+Nof8Ys4pSu4GuUBT3iFQd1jA8+Ca2NOUhf8mFnosWvgKA==` |
| `invoices` | 1.0.14 | `https://downloads.adminium.dev/add-ons/invoices/invoices-1.0.14.tgz` | `invoices-1.0.14.tgz.integrity` holding `sha512-5jf4HxWPX8pqKmzqmUnNVV1nTyou6ghfr5W2k9SywBBH2dWoNDsPrplvDug5licWypYL/VeWj6sN15Vx5p1Aeg==` |
| `offers` | 1.0.14 | `https://downloads.adminium.dev/add-ons/offers/offers-1.0.14.tgz` | `offers-1.0.14.tgz.integrity` holding `sha512-RyKBTEOGKLNs3H3sSuGevFlJD3h2WNzlC9uyf21u+p9Y4AIzxhz4xAR2iZ7/y8i4segFciKhywgrwS/bTBCVMA==` |
| `payments-paypal` | 1.0.14 | `https://downloads.adminium.dev/add-ons/payments-paypal/payments-paypal-1.0.14.tgz` | `payments-paypal-1.0.14.tgz.integrity` holding `sha512-pZmvibAHzr1Ma+jNZW3ZeXBwnof0GOUpP4APBF42ZMx3EEraa374ZvtAXAW++X+9oTT8hM/b6bxDUmu4oNbydQ==` |
| `payments-stripe` | 1.0.14 | `https://downloads.adminium.dev/add-ons/payments-stripe/payments-stripe-1.0.14.tgz` | `payments-stripe-1.0.14.tgz.integrity` holding `sha512-OWhwwemHV6kmZSEUGq+oHjOItrtJrGHtXBJHbnaEtG/97YlFazHXNkt4E83MCMXrhpDdserdsrRTGpzxVmNnbA==` |
| `personalizer` | 1.0.14 | `https://downloads.adminium.dev/add-ons/personalizer/personalizer-1.0.14.tgz` | `personalizer-1.0.14.tgz.integrity` holding `sha512-DvGdm8gGz4JVGv5YcYvCcKLwXuB5+Yy4vqOoYLr7H3MLYzkNCKJhV9+6h+5Efmxxbmx3qg8WPFQzAqvUYn6k/A==` |
| `shipping-dhl` | 1.0.14 | `https://downloads.adminium.dev/add-ons/shipping-dhl/shipping-dhl-1.0.14.tgz` | `shipping-dhl-1.0.14.tgz.integrity` holding `sha512-zUcL7onnvis4+b608DAxlHfoAzGNsE8/0uwiSXYUzXzX7tVxBpfVfaH5X3WRh8vsXdBWhQgsr1F5XTfOPHOQnQ==` |

The key is what an app writes in `manifest/add-ons.json`. To give `adminium app try` an add-on,
put its `.tgz` and a `.tgz.integrity` file holding the fingerprint above in one folder and pass
`--add-ons <folder>`.
