<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md § Sideloading: air-gapped installs; do not edit -->

# Installing apps: Sideloading: air-gapped installs

An install with no outbound network can still add an app. On any connected machine, download the
file from the app's page on [adminium.dev/marketplace](https://adminium.dev/marketplace), or
straight from its address:

```bash
curl -fO https://downloads.adminium.dev/apps/<key>/<key>-<version>.tgz
```

Note the sha512 fingerprint shown beside the Download link — the same value the app's own
`RELEASES.json` records, written there only after the release pipeline read the file back from
`downloads.adminium.dev`. Move the file to the air-gapped machine, choose **Install an app** on the
Hosted apps page, upload it, and paste the fingerprint. The key and version are read from the
manifest inside the bundle; you never type them.

Sideloading is a first-class source, not an escape hatch: the uploaded bytes go through the same
hash verification, hardened unpack and schema plan as a bundled or downloaded one. A tarball that
does not match the fingerprint you pasted is refused, and nothing is staged.
