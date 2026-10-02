<!-- produced from scripts/release/add-ons-bundle.json; do not edit -->

# Add-ons: the first-party set

The add-ons this version of Adminium bundles in its Docker image and desktop app, with the exact
version of each. A newer one may exist: the live list is on the person's own Adminium, under
Workspace settings → Add-ons.

| Key | Version | Package | Fingerprint file |
|---|---|---|---|
| `barcode-labels` | 1.0.7 | `https://downloads.adminium.dev/add-ons/barcode-labels/barcode-labels-1.0.7.tgz` | `barcode-labels-1.0.7.tgz.integrity` holding `sha512-U3atemfywOUlwXOs+1aCrNaC1ViJPGUxutKJt9iPRE0GAO7qtHCMSyoSs3X83LyG/Ex1ys0oT65VpJVr5wnPzw==` |
| `design-studio` | 1.0.7 | `https://downloads.adminium.dev/add-ons/design-studio/design-studio-1.0.7.tgz` | `design-studio-1.0.7.tgz.integrity` holding `sha512-VNLfMRukz3AQPIiMB1F+9wAfth6V/Z1bDJPg3FZFSZfDQWnb03NACAiGsgTsfvCFTblRym5ZtSsUmO2rAGDm2Q==` |
| `holiday-calendars` | 1.0.7 | `https://downloads.adminium.dev/add-ons/holiday-calendars/holiday-calendars-1.0.7.tgz` | `holiday-calendars-1.0.7.tgz.integrity` holding `sha512-NwO3rDfRm65AuyiYAps6R83dyZx0/u1YJgDa+T6V5aWPTQwBYCRY2zcOCUYMuQjF6p/wN0DaenakvVKoyrU+QA==` |
| `import-canva` | 1.0.7 | `https://downloads.adminium.dev/add-ons/import-canva/import-canva-1.0.7.tgz` | `import-canva-1.0.7.tgz.integrity` holding `sha512-9lAZVBNBNg2tc2e3GcJ4izXUWaaZSw/5AeG21v10A9o6je0Ah/tLbBkG4BgPXmmjlWJK0IHBounilvaidmzN0A==` |
| `invoices` | 1.0.7 | `https://downloads.adminium.dev/add-ons/invoices/invoices-1.0.7.tgz` | `invoices-1.0.7.tgz.integrity` holding `sha512-A4ktI198ftL5RgJaNz0kIU6O7RAt5prb/IUa8/Vj9madh2cuB2eswH+Zbo86FTWk3gH86FixR1sSJAFcJu3AVw==` |
| `personalizer` | 1.0.7 | `https://downloads.adminium.dev/add-ons/personalizer/personalizer-1.0.7.tgz` | `personalizer-1.0.7.tgz.integrity` holding `sha512-hME/EpGm2DoBuA6gdzzqwUxsEe7Kh34q9CjBIjV6dl5JnRwiGipTOb8hQuTxAVH8euz/9PPBpFxmtpu+5r/33w==` |
| `shipping-dhl` | 1.0.7 | `https://downloads.adminium.dev/add-ons/shipping-dhl/shipping-dhl-1.0.7.tgz` | `shipping-dhl-1.0.7.tgz.integrity` holding `sha512-Sbu8erXXWbY4BbBa+f6ezg5JWAKc5iErKxGxO4zf5haMBURiYjYlMTAgcdEJ5T1YppU5VLkkmSPz6aaiBIy1sg==` |

The key is what an app writes in `manifest/add-ons.json`. To give `adminium app try` an add-on,
put its `.tgz` and a `.tgz.integrity` file holding the fingerprint above in one folder and pass
`--add-ons <folder>`.
