<!-- produced from apps/docs/src/content/docs/self-hosting/installing-add-ons.md § Sideloading: air-gapped installs; do not edit -->

# Installing add-ons: Sideloading: air-gapped installs

An install with no outbound network can still add packages the bundle does not
carry. On any connected machine, download the file from the add-on's page on
[adminium.dev/marketplace](https://adminium.dev/marketplace), or straight from
its address:

```bash
curl -fO https://downloads.adminium.dev/add-ons/<key>/<key>-<version>.tgz
```

Note the sha512 fingerprint shown beside the Download link. The same value is
recorded in `RELEASES.json` in the
[`Adminiumjs/add-ons`](https://github.com/Adminiumjs/add-ons) repository, where
the release pipeline writes it only after reading the file back from
`downloads.adminium.dev`. Then move the file to the air-gapped machine, upload it
through the **sideload card** on the Add-ons page, and paste the fingerprint.

Sideloading is a first-class source, not an escape hatch: the uploaded bytes go
through the same hash verification and hardened unpack as a bundled or
catalog-fetched package. A tarball that does not match the hash you pasted is
refused.
