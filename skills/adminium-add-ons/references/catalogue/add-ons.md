<!-- produced from scripts/release/add-ons-bundle.json; do not edit -->

# Add-ons: the first-party set

The add-ons this version of Adminium bundles in its Docker image and desktop app, with the exact
version of each. A newer one may exist: the live list is on the person's own Adminium, under
Workspace settings → Add-ons.

| Key | Version | Package | Fingerprint file |
|---|---|---|---|
| `barcode-labels` | 1.0.13 | `https://downloads.adminium.dev/add-ons/barcode-labels/barcode-labels-1.0.13.tgz` | `barcode-labels-1.0.13.tgz.integrity` holding `sha512-7qvweLChIzYRz08SBPhL1zZJDlUP5hgui+R9hFjG9r/VFEl09s/W+55MNfDisa2D9cMPL4Vh+xDh+7j85QO+pQ==` |
| `design-studio` | 1.0.13 | `https://downloads.adminium.dev/add-ons/design-studio/design-studio-1.0.13.tgz` | `design-studio-1.0.13.tgz.integrity` holding `sha512-9ErRRx4nxHdA+UhBANzWABc+NpLHUB+UD4aH58h/BgvcsAKXphextDh64j8qxXQn4HfKfEOGv7Z91lPdNNRHAg==` |
| `holiday-calendars` | 1.0.13 | `https://downloads.adminium.dev/add-ons/holiday-calendars/holiday-calendars-1.0.13.tgz` | `holiday-calendars-1.0.13.tgz.integrity` holding `sha512-4ZdCGOXXORy2iq1Hso2gJFQO8mDOJaklK+m6EWge3X2FPnPFCCJ/DtcZw/68FcrFJQyyWSkD7a8lvPo8JQBl3A==` |
| `import-canva` | 1.0.13 | `https://downloads.adminium.dev/add-ons/import-canva/import-canva-1.0.13.tgz` | `import-canva-1.0.13.tgz.integrity` holding `sha512-5WmjPSrUYNru2mlbENBjSyc+nZNlvRnx8HU8xsJ/M76oWmPr/66LmEob/0npUU3qYhh2PT5TRTHbaZsT/nRzfA==` |
| `inventory` | 1.0.13 | `https://downloads.adminium.dev/add-ons/inventory/inventory-1.0.13.tgz` | `inventory-1.0.13.tgz.integrity` holding `sha512-QoxoiOWDoQ+idLd20Hz0oYAHwUachstTMbKzLkcE0lEsC42+aarxZRD5oSQmpBlCvNap/7mVRM2YkVv+uUoTMA==` |
| `invoices` | 1.0.13 | `https://downloads.adminium.dev/add-ons/invoices/invoices-1.0.13.tgz` | `invoices-1.0.13.tgz.integrity` holding `sha512-6dVR3LIB8h+wEjnCQKDlc+92UTaBh8fXAZw5t3cWnFn8RQiHijJ19DFiTv077h6JDZa2yhKiJ8Cd1+5YmUseVA==` |
| `offers` | 1.0.13 | `https://downloads.adminium.dev/add-ons/offers/offers-1.0.13.tgz` | `offers-1.0.13.tgz.integrity` holding `sha512-GzGNEovEMj0ckKU4KBPjLFle3KWnBLQO+O7yzXWQfi8DqfDVJX2QItO/F1aHoe6tE2ETkBP2qHqPI9gZttj3Qg==` |
| `payments-paypal` | 1.0.13 | `https://downloads.adminium.dev/add-ons/payments-paypal/payments-paypal-1.0.13.tgz` | `payments-paypal-1.0.13.tgz.integrity` holding `sha512-XKMFN+38vice4NMznoaJ0B/fY3v9tFZl/Z6KqHip80iJd1p1ziN0x6wCzBlFXzA3o6D6soUqot5viMFXWghKpw==` |
| `payments-stripe` | 1.0.13 | `https://downloads.adminium.dev/add-ons/payments-stripe/payments-stripe-1.0.13.tgz` | `payments-stripe-1.0.13.tgz.integrity` holding `sha512-Y3STDH5lVNbw4/kEUs0rTkdOT+tKoUFEsjEADzW/+Omw3c4Ct9s3CAQP3y/5yMLMNX3y/dSqUV8dLs0AxH7lXQ==` |
| `personalizer` | 1.0.13 | `https://downloads.adminium.dev/add-ons/personalizer/personalizer-1.0.13.tgz` | `personalizer-1.0.13.tgz.integrity` holding `sha512-Ecffs+9oZZCkx8HyDdAaw5UVOqDN152bhUAAS4GAzwQX3b0ZjP1bfY/1JuNxSfFDy2fkJkPIIHjqTmRwImjznQ==` |
| `shipping-dhl` | 1.0.13 | `https://downloads.adminium.dev/add-ons/shipping-dhl/shipping-dhl-1.0.13.tgz` | `shipping-dhl-1.0.13.tgz.integrity` holding `sha512-BHzonC9NpT29NVZ/wAY0bxGbV3zVXuC0jqNleqwAmcr21JVlyTNUe3J0IUq2GnI4jVJRsQSxFXY1tStCJp2EDQ==` |

The key is what an app writes in `manifest/add-ons.json`. To give `adminium app try` an add-on,
put its `.tgz` and a `.tgz.integrity` file holding the fingerprint above in one folder and pass
`--add-ons <folder>`.
