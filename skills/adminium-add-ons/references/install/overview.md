<!-- produced from apps/docs/src/content/docs/self-hosting/installing-add-ons.md; do not edit -->

# Installing add-ons

Add-ons are packages that extend a deployment — extra blocks, data packs,
integrations — installed and managed from **Workspace settings → Add-ons**. Every package,
whatever its source, goes through the same pipeline on the way in: its sha512
hash is verified against a pinned value, the archive is unpacked under hardened
limits, and its manifest is validated before anything is registered.

This page is about where packages come from, and what each source does — and
does not — send over the network.
