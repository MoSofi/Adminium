<!-- produced from scripts/release/add-ons-bundle.json; do not edit -->

# Add-ons: the first-party set

The add-ons this version of Adminium bundles in its Docker image and desktop app, with the exact
version of each. A newer one may exist: the live list is on the person's own Adminium, under
Workspace settings → Add-ons.

| Key | Version | Package | Fingerprint file |
|---|---|---|---|
| `barcode-labels` | 1.0.12 | `https://downloads.adminium.dev/add-ons/barcode-labels/barcode-labels-1.0.12.tgz` | `barcode-labels-1.0.12.tgz.integrity` holding `sha512-2S7kgp0DmcO5ijsTc2SYM8lAmL9DIlb+kixM8C56Bvv92XlA9E62KpMvDIUQN4aoFPu+TOJ1HuS7tjFvSK4a4g==` |
| `design-studio` | 1.0.12 | `https://downloads.adminium.dev/add-ons/design-studio/design-studio-1.0.12.tgz` | `design-studio-1.0.12.tgz.integrity` holding `sha512-FniVNIoZogkgjh4fUOl1eHoeS9GAZspqQVpQPKMWR+GdRHkdWaszgc9XZhFrIhlJRbxlng97Z6fl6ZD/dB4B3g==` |
| `holiday-calendars` | 1.0.12 | `https://downloads.adminium.dev/add-ons/holiday-calendars/holiday-calendars-1.0.12.tgz` | `holiday-calendars-1.0.12.tgz.integrity` holding `sha512-Ngv50g06nCyGp/kfst1fiqfScfT/U0GUytY8bg0bOAhBUr64zel4msGU79cLL/iQKlFVy3vUahoUNkN22wsiQQ==` |
| `import-canva` | 1.0.12 | `https://downloads.adminium.dev/add-ons/import-canva/import-canva-1.0.12.tgz` | `import-canva-1.0.12.tgz.integrity` holding `sha512-xttAKw6mT0cGRn17fbhUFM2FvhlQcPY7M8xU8VnLa94xPCDZI9V65VaemimUFCMbc2pD3SmEFQ5siIpHX/fNyQ==` |
| `inventory` | 1.0.12 | `https://downloads.adminium.dev/add-ons/inventory/inventory-1.0.12.tgz` | `inventory-1.0.12.tgz.integrity` holding `sha512-FkRzhKcugTVRgS4iESzhedbsQjcuUlxO8tcqXQHEPKCIMDLz/uMl4OnSWfTkQzftxOMpIO7eej3m51mXxjoYOw==` |
| `invoices` | 1.0.12 | `https://downloads.adminium.dev/add-ons/invoices/invoices-1.0.12.tgz` | `invoices-1.0.12.tgz.integrity` holding `sha512-Im0sul//yH1l1h89JABP/o+Ko123idjkwiVTtMYTI2yiSwggqJtpa3p5Lgtk2NoSoKmx3s331MB3esPPvnmhPA==` |
| `offers` | 1.0.12 | `https://downloads.adminium.dev/add-ons/offers/offers-1.0.12.tgz` | `offers-1.0.12.tgz.integrity` holding `sha512-Br6KpAw3iZoKN66zake7hBsO/gV4jg/AUVAlw6tqfYoo+11pE1I8lPm8+mR67HRRzT2+FYXJM9vSh0Jm5d8AdA==` |
| `personalizer` | 1.0.12 | `https://downloads.adminium.dev/add-ons/personalizer/personalizer-1.0.12.tgz` | `personalizer-1.0.12.tgz.integrity` holding `sha512-lCZItvtzDBecebVD4kAUtWSOKF+L/xstJLecNqs06vsOOVv+h+dF6QHfDSNnBaC63G0VXr39MdAaFM8auPeY7Q==` |
| `shipping-dhl` | 1.0.12 | `https://downloads.adminium.dev/add-ons/shipping-dhl/shipping-dhl-1.0.12.tgz` | `shipping-dhl-1.0.12.tgz.integrity` holding `sha512-5jfzMOvmz1+5r4OfV4sJKLhCcDrqKb5tw9maFhtmMbcU/77AuYrdak+WHSEwmxDDaAfGWz1jrn8ByPbnMaUHbQ==` |

The key is what an app writes in `manifest/add-ons.json`. To give `adminium app try` an add-on,
put its `.tgz` and a `.tgz.integrity` file holding the fingerprint above in one folder and pass
`--add-ons <folder>`.
