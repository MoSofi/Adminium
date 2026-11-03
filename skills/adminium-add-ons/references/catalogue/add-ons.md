<!-- produced from scripts/release/add-ons-bundle.json; do not edit -->

# Add-ons: the first-party set

The add-ons this version of Adminium bundles in its Docker image and desktop app, with the exact
version of each. A newer one may exist: the live list is on the person's own Adminium, under
Workspace settings → Add-ons.

| Key | Version | Package | Fingerprint file |
|---|---|---|---|
| `barcode-labels` | 1.0.15 | `https://downloads.adminium.dev/add-ons/barcode-labels/barcode-labels-1.0.15.tgz` | `barcode-labels-1.0.15.tgz.integrity` holding `sha512-dVcOOm5wJvc/1Sto9+4NNB7t6dnR9ECK2poLp3XsGqhUs+dLPZ2LmlRsRGae4LspGuKvcULttN4abny262iFvg==` |
| `design-studio` | 1.0.15 | `https://downloads.adminium.dev/add-ons/design-studio/design-studio-1.0.15.tgz` | `design-studio-1.0.15.tgz.integrity` holding `sha512-NRSruX6Zbsl6YMD+44FnLqmJExshcILmPSIGtbmzyYUIiAbfFBucxtCF4iIIqkYrhL2RuzOZtZG+5d5eQC7Wzg==` |
| `forms` | 1.0.15 | `https://downloads.adminium.dev/add-ons/forms/forms-1.0.15.tgz` | `forms-1.0.15.tgz.integrity` holding `sha512-XM7iozk6CyQqGuuHRVKsTmHv77GGzb48zpTKjaAfcaZYjFMRh44jLDjiH/uULBV8gY4ZHR26VEN6Tw0GRKsh4A==` |
| `holiday-calendars` | 1.0.15 | `https://downloads.adminium.dev/add-ons/holiday-calendars/holiday-calendars-1.0.15.tgz` | `holiday-calendars-1.0.15.tgz.integrity` holding `sha512-LwLrgsnfkpKfmpczJnLNQnqXj5cuJcI2gpB3dvmkZKor7FWLBdDjMGMZ6TEP/Hl6QoJJDlsKS1P5wi4sy1JdsA==` |
| `import-canva` | 1.0.15 | `https://downloads.adminium.dev/add-ons/import-canva/import-canva-1.0.15.tgz` | `import-canva-1.0.15.tgz.integrity` holding `sha512-9W7achaH7jMAN5kpkLuDrPpNvaoHWDVpI/Xsz28NNM3WHI+iFevErIg6zBcStoaHk+JcdxymIucecDT7cgujig==` |
| `inventory` | 1.0.15 | `https://downloads.adminium.dev/add-ons/inventory/inventory-1.0.15.tgz` | `inventory-1.0.15.tgz.integrity` holding `sha512-ADI2BTdtVkknnawdHxV35JIbH6anFyyjbacsEKtYv/rYk2oBx3MPWiER2CoLonPvqYSSSewEXdzSPakULs5SGQ==` |
| `invoices` | 1.0.15 | `https://downloads.adminium.dev/add-ons/invoices/invoices-1.0.15.tgz` | `invoices-1.0.15.tgz.integrity` holding `sha512-VKuLwnDXaAbm7yxuNDhlSakfCS06OhajuBYqRvVuMn61Arw1Sw4szi2EqycFA1Wk1roBPX9GE/vtt1cYSTWHzA==` |
| `offers` | 1.0.15 | `https://downloads.adminium.dev/add-ons/offers/offers-1.0.15.tgz` | `offers-1.0.15.tgz.integrity` holding `sha512-S0p1Ifto+7l4y1SBXjwKSmAE3fb85K+6Bc6vgfAB31WQ4TiuR3Milgkw103UPqMuB17htPsl5QfUcudg7Y4rVw==` |
| `payments-paypal` | 1.0.15 | `https://downloads.adminium.dev/add-ons/payments-paypal/payments-paypal-1.0.15.tgz` | `payments-paypal-1.0.15.tgz.integrity` holding `sha512-dXk0dhKDtyCVk73wq5S+Bp34ek+2AKXCj0TvYiGLXBCNnslek1WitJTDu72/CmXXcOpt5sBzCLrYG9ZaOTTQRQ==` |
| `payments-stripe` | 1.0.15 | `https://downloads.adminium.dev/add-ons/payments-stripe/payments-stripe-1.0.15.tgz` | `payments-stripe-1.0.15.tgz.integrity` holding `sha512-DeRNQ6sClJS6rAVV8CJyx/98qcFP21+ULL0CGs798sBps3GsspI5vAgVwfXEBF+vGNc4fkKqv2XTjSWk3ZpaAA==` |
| `personalizer` | 1.0.15 | `https://downloads.adminium.dev/add-ons/personalizer/personalizer-1.0.15.tgz` | `personalizer-1.0.15.tgz.integrity` holding `sha512-B1rlKkLZUDgGc/CbStzIFAcar4St0HOzO5GpFuGhT/qsEcL9ZB/Cz5ckF4eP3bBVr4/+845OH5B9DlnW0AWndA==` |
| `shipping-dhl` | 1.0.15 | `https://downloads.adminium.dev/add-ons/shipping-dhl/shipping-dhl-1.0.15.tgz` | `shipping-dhl-1.0.15.tgz.integrity` holding `sha512-AAUXKudgmXbDSbJM1dRNZ7xQIN8Guim7qc0R2n9GrP1eCfGss8PL102iG5/INIL38ce8ryyRWS7z43FyJJj9dA==` |

The key is what an app writes in `manifest/add-ons.json`. To give `adminium app try` an add-on,
put its `.tgz` and a `.tgz.integrity` file holding the fingerprint above in one folder and pass
`--add-ons <folder>`.
