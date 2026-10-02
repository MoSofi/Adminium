<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md § Three sources, one pipeline; do not edit -->

# Installing apps: Three sources, one pipeline

| Source | Network | Where it comes from |
|---|---|---|
| **Bundled** | none | Tarballs in the folder [`ADMINIUM_BUNDLED_APPS`](https://docs.adminium.dev/self-hosting/installing-apps/#adminium_bundled_apps) names, seeded into the app store at boot. |
| **Uploaded** | none | A `.tgz` you upload yourself, with the fingerprint you paste. |
| **The online app catalogue** | opt-in | Released apps listed by adminium.dev, downloaded from `downloads.adminium.dev`. |

No build Adminium publishes carries a bundled app set — not the Docker image, not the desktop app,
not a source checkout — so the shelf is empty until you upload an app or switch browsing online on.
That is expected, not a misconfiguration. An image you build yourself can carry one.
