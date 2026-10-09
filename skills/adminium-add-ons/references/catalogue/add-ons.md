<!-- produced from scripts/release/add-ons-bundle.json; do not edit -->

# Add-ons: the first-party set

The add-ons this version of Adminium bundles in its Docker image and desktop app, with the exact
version of each. A newer one may exist: the live list is on the person's own Adminium, under
Workspace settings → Add-ons.

| Key | Version | Package | Fingerprint file |
|---|---|---|---|
| `barcode-labels` | 1.0.10 | `https://downloads.adminium.dev/add-ons/barcode-labels/barcode-labels-1.0.10.tgz` | `barcode-labels-1.0.10.tgz.integrity` holding `sha512-ntRS+UK1X9U0xYKy3kJMgtBXOrqwgbhCbUwTPjd9aaQ/XEXXhZW7uVO2ix7YCaE8GQHB9iC4ZlWl3go8JaRubQ==` |
| `design-studio` | 1.0.10 | `https://downloads.adminium.dev/add-ons/design-studio/design-studio-1.0.10.tgz` | `design-studio-1.0.10.tgz.integrity` holding `sha512-ox8fNesW+wnp2+JUw+aNuBjUukFIXim/uIRI4Tnqc4m8yIrxWFuVM9hFP0XKhHwqpSUET6bO8UFFb2I8+xkfhg==` |
| `holiday-calendars` | 1.0.10 | `https://downloads.adminium.dev/add-ons/holiday-calendars/holiday-calendars-1.0.10.tgz` | `holiday-calendars-1.0.10.tgz.integrity` holding `sha512-n2Sc8CYn0XIocSJ43NrKm1xAiobmEPYWe60PbfJwXhzY7LWMT+jrghvdvtpLqNEbtPjC4+jAIq/WhpdVTISg/Q==` |
| `import-canva` | 1.0.10 | `https://downloads.adminium.dev/add-ons/import-canva/import-canva-1.0.10.tgz` | `import-canva-1.0.10.tgz.integrity` holding `sha512-Yok8R9jv/KN52V8Xy6WxfVEOsK6qxLxfPmC8A6NFERyEcdVINIJwx0GW6EGvqD0Vz6LJmt7oCtgyB+Wdefrbyw==` |
| `inventory` | 1.0.10 | `https://downloads.adminium.dev/add-ons/inventory/inventory-1.0.10.tgz` | `inventory-1.0.10.tgz.integrity` holding `sha512-PWOlDZwAfGnEfjBByd2hTzrDQSMS/3eikwgZ4vkZmH03slLKdZ7FReQe76OXIAZZdNVDpZda6b9VE2FGYkgr1g==` |
| `invoices` | 1.0.10 | `https://downloads.adminium.dev/add-ons/invoices/invoices-1.0.10.tgz` | `invoices-1.0.10.tgz.integrity` holding `sha512-v0sQfQBbcHsZ4ABR+RHfpGsUBnsD4rQ9rZTBxKAfWUGi980aygnBwPfW2aRZP2l1NTuTqeMQ1eEiZPlK6Ttgpg==` |
| `offers` | 1.0.10 | `https://downloads.adminium.dev/add-ons/offers/offers-1.0.10.tgz` | `offers-1.0.10.tgz.integrity` holding `sha512-jJB0Mi5dNB2D4Q7bNm83HNHu37e1fQavqzUlHgB0T4QSDfS4319vY45p+cUs3/duKAgME50FTouaz6OH7HdAgQ==` |
| `personalizer` | 1.0.10 | `https://downloads.adminium.dev/add-ons/personalizer/personalizer-1.0.10.tgz` | `personalizer-1.0.10.tgz.integrity` holding `sha512-OeCrF3o6sNGZ1bq4ldd29orIOfXL5BzywqVvjyHUPsLXYzWpS2YeRDy3U5hnD8O4LbizZkz2Np+0abOczB0Rhw==` |
| `shipping-dhl` | 1.0.10 | `https://downloads.adminium.dev/add-ons/shipping-dhl/shipping-dhl-1.0.10.tgz` | `shipping-dhl-1.0.10.tgz.integrity` holding `sha512-DxpAuS91L7uGWHb+rSrwaWUURr7/Dfzs+rNAeNfVF2Kr3HWW5NgctiBsWXy3FTF+BudywH87S8yd4jmGAL/Ovw==` |

The key is what an app writes in `manifest/add-ons.json`. To give `adminium app try` an add-on,
put its `.tgz` and a `.tgz.integrity` file holding the fingerprint above in one folder and pass
`--add-ons <folder>`.
