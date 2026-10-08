<!-- produced from scripts/release/add-ons-bundle.json; do not edit -->

# Add-ons: the first-party set

The add-ons this version of Adminium bundles in its Docker image and desktop app, with the exact
version of each. A newer one may exist: the live list is on the person's own Adminium, under
Workspace settings → Add-ons.

| Key | Version | Package | Fingerprint file |
|---|---|---|---|
| `barcode-labels` | 1.0.8 | `https://downloads.adminium.dev/add-ons/barcode-labels/barcode-labels-1.0.8.tgz` | `barcode-labels-1.0.8.tgz.integrity` holding `sha512-oOlnJfT8N9MkBbqAwzu00x34q964pG3LMp5dPUjILrVRErGbjHduGPjWIuweovoCy/GCEi3Qglv7AJdK0WAvuw==` |
| `design-studio` | 1.0.8 | `https://downloads.adminium.dev/add-ons/design-studio/design-studio-1.0.8.tgz` | `design-studio-1.0.8.tgz.integrity` holding `sha512-zklVXP59UKzpsFkPmrPkbSG/tzhOk5uWperbxGzB0kzBXlyRKwWk8p6SZmoUuiwgDfrd2TQryJA1+SQEG4j1CA==` |
| `holiday-calendars` | 1.0.8 | `https://downloads.adminium.dev/add-ons/holiday-calendars/holiday-calendars-1.0.8.tgz` | `holiday-calendars-1.0.8.tgz.integrity` holding `sha512-AxzZqhXb3lET4l1SiXyJVtlIo7Q9+UhX7d4vtowZrc2UkrMGJQzbA9Bh/iZqj8eME8NJAZIPkpdC1WN3i3AQLw==` |
| `import-canva` | 1.0.8 | `https://downloads.adminium.dev/add-ons/import-canva/import-canva-1.0.8.tgz` | `import-canva-1.0.8.tgz.integrity` holding `sha512-u3W5+n0LIWlgax7Mn7NN3Xvi4t0sYBP+ZwxqQpFvUCHuN7k0+eurYMeE1o50vwhQWcc6lXe3WcpR+/YyeGn3Xw==` |
| `inventory` | 1.0.8 | `https://downloads.adminium.dev/add-ons/inventory/inventory-1.0.8.tgz` | `inventory-1.0.8.tgz.integrity` holding `sha512-Tek9t9e6bxyS7LygsAMA2CGftZ8jOTp+bu9c236ywLjwOkCWWKYRMpUOjtrYXV+GIOet06FND8ekG5k6MBOb/A==` |
| `invoices` | 1.0.8 | `https://downloads.adminium.dev/add-ons/invoices/invoices-1.0.8.tgz` | `invoices-1.0.8.tgz.integrity` holding `sha512-Um7ZBVroDXJCRuI/sEgiU5wjLrKasj7s5mduO0PdOq6Dr3AlOBy3x+S2nWmBKv+ZoVfoXNJJu3/9C1+a4TQaEQ==` |
| `personalizer` | 1.0.8 | `https://downloads.adminium.dev/add-ons/personalizer/personalizer-1.0.8.tgz` | `personalizer-1.0.8.tgz.integrity` holding `sha512-j9C/7Vn5RzmS0OW/JqofCLGNompFeMTed0RhL9lHgVG4JGfQ3iK0OZCq3dads67xeyUN0CX/prhLI7YpJX01nw==` |
| `shipping-dhl` | 1.0.8 | `https://downloads.adminium.dev/add-ons/shipping-dhl/shipping-dhl-1.0.8.tgz` | `shipping-dhl-1.0.8.tgz.integrity` holding `sha512-383ncUsLQXB1poEPbkScUbbLPXmSS7zQ0ZQMfWSFw7KM0QTxVS9PyGijSievWA0MQY92OB0hX1JK8qIpovSrXw==` |

The key is what an app writes in `manifest/add-ons.json`. To give `adminium app try` an add-on,
put its `.tgz` and a `.tgz.integrity` file holding the fingerprint above in one folder and pass
`--add-ons <folder>`.
