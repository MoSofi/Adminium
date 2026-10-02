<!-- produced from apps/docs/src/content/docs/self-hosting/installing-add-ons.md § On a host with no persistent disk; do not edit -->

# Installing add-ons: On a host with no persistent disk

An installed add-on's files are kept in `ADMINIUM_DATA_DIR/add-ons`. The meta store only records
that it is installed, with its settings and credentials. On a host that empties the data directory
on every deploy — DigitalOcean App Platform, or a container with no volume — the boot copies back
only what the image bundles, at the bundled version:

- **A bundled add-on, installed at the bundled version, comes back by itself.**
- **Any other add-on is lost at the next deploy**: one you uploaded, or one you updated past the
  image's copy. The Add-ons page lists it under **Installed** marked **Missing**, with a line
  saying its files are not on this server. The boot log names it too: `installed add-on is not on
  this server …`, with its key and version.

  Before 0.3.0 that row read as a healthy install — including its green **Connected** badge, since
  the stored credential outlives the volume while the files do not — and an add-on the cached
  catalog feed did not carry, which is every one you uploaded yourself, was left out of the browse
  list entirely. The log was the only place the loss was stated.
- **A newer Adminium image can bundle a newer version.** Then the version you installed from the
  old image is lost the same way. The Add-ons page offers **Upgrade** to the version the new image
  carries, and upgrading brings the add-on back.
- The cached online catalog is gone too, until **Check for newer** runs again.

To bring a lost add-on back, upload the same package again through the sideload card, with its
fingerprint. It is back at once, server code included, with its settings and connection as they
were.

To keep add-ons across deploys, run Adminium where the data directory is on a persistent disk, or
build your own image that carries them — see [`ADMINIUM_BUNDLED_ADD_ONS`](https://docs.adminium.dev/self-hosting/installing-add-ons/#adminium_bundled_add_ons).
